import {afterEach, expect, it, vi} from "vitest";
import {createClinpgxApiFetch} from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());
it.each([{method: "POST", path: "/data/gene"}, {method: "GET", path: "/data/gene", body: {}}])("rejects annotation writes rather than silently converting them to reads %#", async request => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(createClinpgxApiFetch()(request)).rejects.toMatchObject({status: 405});
  expect(fetch).not.toHaveBeenCalled();
});
it("isolates CPIC native queries from ClinPGx annotations", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("[]", {headers: {"content-type": "application/json"}}));
  vi.stubGlobal("fetch", fetch);
  const api = createClinpgxApiFetch();
  expect(await api({method: "GET", path: "/cpic/recommendation_view", params: {drugname: "eq.rosuvastatin"}})).toMatchObject({data: {records: [], _cpic: {resource: "recommendation_view", data_release: null}}});
  expect(new URL(fetch.mock.calls[0][0]).origin).toBe("https://api.cpicpgx.org");
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get("drugname")).toBe("eq.rosuvastatin");
  await api({method: "GET", path: "/data/guidelineAnnotation", params: {source: "cpic"}});
  expect(new URL(fetch.mock.calls[1][0]).origin).toBe("https://api.clinpgx.org");
});

it("keeps a CPIC 404 as an error while preserving ClinPGx's documented empty result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("No results matching criteria", {status: 404})));
  const api = createClinpgxApiFetch();
  await expect(api({method: "GET", path: "/cpic/gene"})).rejects.toMatchObject({status: 404});
  expect(await api({method: "GET", path: "/data/gene"})).toEqual({status: 200, data: {data: [], status: "success"}});
});
