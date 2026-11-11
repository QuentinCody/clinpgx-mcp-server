import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {registerDrugLookup} from "./drug-lookup";
import {clinpgxFetch} from "../lib/http";

vi.mock("../lib/http", () => ({clinpgxFetch: vi.fn()}));
afterEach(() => vi.resetAllMocks());

function handler() {
  const server = new McpServer({name: "fixture", version: "1"});
  registerDrugLookup(server, {});
  // SAFETY: inspect the SDK registry only in tests to exercise the real handler.
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  return tools.clinpgx_drug_lookup.handler;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});

it("returns UPSTREAM_ERROR when both lookup paths fail with a non-404 status", async () => {
  vi.mocked(clinpgxFetch).mockImplementation(async () => json({error: "unavailable"}, 503));
  const result = await handler()({name: "warfarin"}, {});
  expect(result).toMatchObject({
    isError: true,
    structuredContent: {success: false, error: {code: "UPSTREAM_ERROR", status: 503}},
  });
});

it("returns UPSTREAM_ERROR when the direct lookup is empty and the search fallback fails", async () => {
  vi.mocked(clinpgxFetch)
    .mockImplementationOnce(async () => json({data: []}))
    .mockImplementationOnce(async () => json({error: "boom"}, 500));
  const result = await handler()({name: "warfarin"}, {});
  expect(result).toMatchObject({isError: true, structuredContent: {success: false, error: {code: "UPSTREAM_ERROR", status: 500}}});
});

it("treats 404 on both paths as a real absence", async () => {
  vi.mocked(clinpgxFetch).mockImplementation(async () => json({error: "not found"}, 404));
  const result = await handler()({name: "notadrug"}, {});
  expect(result).toMatchObject({structuredContent: {success: true, data: {total: 0, results: []}}});
  expect((result as {isError?: boolean}).isError).toBeUndefined();
});

it("returns drugs from the search fallback when the direct lookup fails", async () => {
  vi.mocked(clinpgxFetch)
    .mockImplementationOnce(async () => json({error: "boom"}, 500))
    .mockImplementationOnce(async () => json({data: [{obj: {id: "PA451906", name: "warfarin", objCls: "Chemical"}}]}));
  const result = await handler()({name: "warfarin"}, {});
  expect(result).toMatchObject({structuredContent: {success: true, data: {total: 1}}});
});
