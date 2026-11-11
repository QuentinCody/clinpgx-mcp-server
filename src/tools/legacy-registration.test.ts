import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {registerLegacyTools} from "./legacy-registration";
import {clinpgxFetch} from "../lib/http";

vi.mock("../lib/http", () => ({clinpgxFetch: vi.fn()}));
afterEach(() => vi.resetAllMocks());
const cases = [
  ["gene_lookup", {symbol: "CYP2C19"}],
  ["drug_lookup", {name: "clopidogrel"}],
  ["clinical_annotations", {gene: "CYP2C19"}],
  ["guideline_annotations", {gene: "CYP2C19"}],
] as const;

it.each(cases)("preserves both aliases and success/error envelopes for %s", async (suffix, args) => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerLegacyTools(server, {});
  // SAFETY: inspect the SDK registry only in tests to exercise the real handlers.
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  const fetch = vi.mocked(clinpgxFetch);
  for (const prefix of ["clinpgx", "mcp_clinpgx"]) {
    fetch.mockImplementation(async () => new Response(JSON.stringify({data: [{id: "fixture", name: "fixture", symbol: "CYP2C19"}]}), {headers: {"Content-Type": "application/json"}}));
    expect(await tools[`${prefix}_${suffix}`].handler(args, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
    fetch.mockImplementation(async () => {throw new Error("fixture network failure");});
    expect(await tools[`${prefix}_${suffix}`].handler(args, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: {success: false}});
  }
  expect(Object.keys(tools)).toHaveLength(8);
});
