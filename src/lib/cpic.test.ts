import {afterEach, expect, it, vi} from "vitest";
import {CPIC_RESOURCES, cpicRead} from "./cpic";
const response = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json", "Content-Range": "0-1/*"}});
afterEach(() => vi.unstubAllGlobals());
it("preserves all recommendation records and composite lookup keys", async () => {
  // Synthetic preservation fixture, not a clinical recommendation or live-schema claim.
  const records = [{lookupkey: {ABCG2: "No Result", SLCO1B1: "Decreased Function"}, population: "adults", strength: "strong", extra: {retain: true}}, {lookupkey: {ABCG2: "Normal Function", SLCO1B1: "Decreased Function"}, population: "other", strength: "optional"}];
  const fetcher = vi.fn().mockResolvedValue(response(records)); vi.stubGlobal("fetch", fetcher);
  const lookup = 'cd.{"ABCG2":"No Result","SLCO1B1":"Decreased Function"}';
  const result = await cpicRead({method: "GET", path: "/cpic/recommendation_view", params: {lookupkey: lookup, limit: 2, offset: 0}});
  expect(result).toMatchObject({data: {records, _cpic: {api_version: null, data_release: null, snapshot_is_atomic: false, pagination: {returned: 2, completeness: "not_established", next_offset_candidate: 2}}}});
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.hostname).toBe("api.cpicpgx.org"); expect(url.searchParams.get("lookupkey")).toBe(lookup);
});
it.each(CPIC_RESOURCES)("supports a bounded native read of %s", async resource => {
  const fetcher = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetcher);
  expect(await cpicRead({method: "GET", path: `/cpic/${resource}`})).toMatchObject({data: {records: [], _cpic: {pagination: {limit: 50, offset: 0, returned: 0, completeness: "not_established"}}}});
  expect(fetcher.mock.calls[0][0]).toBe(`https://api.cpicpgx.org/v1/${resource}?limit=50&offset=0`);
});
it("exposes the full schema without treating its API version as a data release", async () => {
  const schema = {swagger: "2.0", info: {version: "12.0.2"}, paths: {"/gene": {get: {}}}};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(schema)));
  expect(await cpicRead({method: "GET", path: "/cpic/schema"})).toMatchObject({data: {schema, _cpic: {data_release: null, pagination: null}}});
});
it.each([
  {method: "POST", path: "/cpic/gene"}, {method: "GET", path: "/cpic/gene", body: {}},
  {method: "GET", path: "/cpic/../gene"}, {method: "GET", path: "/cpic/rpc/recommendation_lookup"},
  {method: "GET", path: "/cpic/gene?limit=900"}, {method: "GET", path: "/cpic/schema", params: {limit: 1}},
  ...[0, 201, -1, 1.5, true, "1e2", "bad", NaN].map(limit => ({method: "GET", path: "/cpic/gene", params: {limit}})),
  {method: "GET", path: "/cpic/gene", params: {offset: 1000001}},
  {method: "GET", path: "/cpic/gene", params: {gene: {nested: true}}},
  {method: "GET", path: "/cpic/gene", params: {"wrong-key": "eq.x"}},
  {method: "GET", path: "/cpic/gene", params: {gene: "x".repeat(8001)}},
] as const)("rejects unsupported or unbounded requests %#", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(cpicRead(request)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([{}, [null], [1], [[1]]])("rejects malformed table response %#", async value => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(value)));
  await expect(cpicRead({method: "GET", path: "/cpic/gene"})).rejects.toMatchObject({status: 502});
});
it("rejects an upstream that ignores the requested row limit", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{}, {}])));
  await expect(cpicRead({method: "GET", path: "/cpic/gene", params: {limit: 1}})).rejects.toMatchObject({status: 502});
});
