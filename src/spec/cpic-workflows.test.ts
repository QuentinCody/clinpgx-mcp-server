import {expect, it, vi} from "vitest";
import {cpicWorkflows} from "./cpic-workflows";

const row = (value: string) => ({genesymbol: "SLCO1B1", lookupkey: {SLCO1B1: value}});
const page = (records: unknown[]) => ({records, _cpic: {pagination: {completeness: "not_established"}}});
async function run(get: ReturnType<typeof vi.fn>, code = cpicWorkflows[0].code) {
  // SAFETY: executes only the repository-owned recipe with a fixture API, never external code.
  return new Function("api", `return (async () => {${code}})()` )({get});
}

it("retains ambiguous translation alternatives and explicitly requests No Result", async () => {
  const translation = page([row("Decreased Function"), row("Possible Decreased Function")]);
  const recommendation = page([{population: "fixture one"}, {population: "fixture two"}]);
  const get = vi.fn().mockResolvedValueOnce(translation).mockResolvedValue(recommendation);
  const result = await run(get);
  expect(get.mock.calls[0][1].diplotypekey).toBe('eq.{"SLCO1B1":{"*15":1,"*37":1}}');
  expect(get.mock.calls.slice(1).map(call => call[1].lookupkey)).toEqual([
    'cd.{"SLCO1B1":"Decreased Function","ABCG2":"No Result"}',
    'cd.{"SLCO1B1":"Possible Decreased Function","ABCG2":"No Result"}',
  ]);
  expect(result.translations[0].page).toEqual(translation);
  expect(result.matches.map((match: {page: unknown}) => match.page)).toEqual([recommendation, recommendation]);
  expect(result.snapshot_is_atomic).toBe(false);
});

it.each([
  page([]), page(Array.from({length: 200}, () => row("fixture"))),
  {__staged: true, data_access_id: "inspect"}, {__api_error: true},
  page([{genesymbol: "ABCG2", lookupkey: {ABCG2: "fixture"}}]),
  page([{genesymbol: "SLCO1B1", lookupkey: {SLCO1B1: null}}]),
  page(Array.from({length: 26}, () => row("fixture"))),
])("does not request recommendations for unresolved translation %#", async translation => {
  const get = vi.fn().mockResolvedValue(translation);
  expect(await run(get)).toMatchObject({status: "translation_requires_inspection", matches: []});
  expect(get).toHaveBeenCalledTimes(1);
});

it("preserves staged recommendation handles for subsequent SQL inspection", async () => {
  const staged = {__staged: true, data_access_id: "all-matches", _cpic: {pagination: {next_offset_candidate: 50}}};
  const get = vi.fn().mockResolvedValueOnce(page([row("fixture")])).mockResolvedValue(staged);
  expect((await run(get)).matches[0].page).toEqual(staged);
});

it("combines two native lookup keys without replacing activity scores with phenotypes", async () => {
  const get = vi.fn().mockResolvedValueOnce(page([row("fixture")]))
    .mockResolvedValueOnce(page([{genesymbol: "ABCG2", lookupkey: {ABCG2: "0.5"}, generesult: "different display label"}]))
    .mockResolvedValue(page([]));
  const code = cpicWorkflows[0].code.replace("ABCG2: null", 'ABCG2: {"fixture allele": 2}');
  const result = await run(get, code);
  expect(result.matches[0].lookupkey).toEqual({SLCO1B1: "fixture", ABCG2: "0.5"});
  expect(get.mock.calls[1][1].diplotypekey).toBe('eq.{"ABCG2":{"fixture allele":2}}');
});
