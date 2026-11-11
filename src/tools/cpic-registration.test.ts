import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";
import {clinpgxCatalog} from "../spec/catalog";
import {createClinpgxApiFetch} from "../lib/api-adapter";

const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());

it("registers both aliases and returns both fields for discovery and errors", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  // SAFETY: no isolate runs here; the loader is only constructed.
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  // SAFETY: SDK registry access is test-only to exercise actual handlers.
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) {
    expect(tools[`clinpgx_${suffix}`]).toBeDefined(); expect(tools[`mcp_clinpgx_${suffix}`]).toBeDefined();
  }
  for (const prefix of ["clinpgx", "mcp_clinpgx"]) {
    expect(await tools[`${prefix}_search`].handler({query: "cpic", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
    expect(await tools[`${prefix}_execute`].handler({code: ""}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
    expect(await tools[`${prefix}_query_data`].handler({data_access_id: "fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
  }
  expect(clinpgxCatalog.endpointCount).toBe(clinpgxCatalog.endpoints.length);
});

it("stages native composite keys, every match and provenance losslessly", async () => {
  const records = [{lookupkey: {CYP2C19: "No Result", SLCO1B1: "fixture"}, population: "fixture population", drugrecommendation: "α".repeat(20000)}, {lookupkey: {SLCO1B1: "fixture"}, population: "another population", drugrecommendation: "second fixture"}];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json(records)));
  const stored: unknown[] = [];
  // SAFETY: fixture implements the two methods consumed by staging.
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      const payload = await request.json() as {data: unknown}; stored.push(payload.data);
      return json({success: true, tables_created: ["payloads"], total_rows: 1});
    }
    return json({success: true, schema: {tables: {payloads: {columns: [{name: "root_json"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createClinpgxApiFetch(), catalog: clinpgxCatalog, doNamespace: namespace, stagingPrefix: "clinpgx", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/cpic/recommendation_view", params: {limit: 2}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  const payloads = stored.map(value => typeof value === "string" ? JSON.parse(value) : value);
  expect(payloads).toEqual(expect.arrayContaining([expect.objectContaining({records, _cpic: expect.objectContaining({data_release: null, snapshot_is_atomic: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)})})]));
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});

it("returns incomplete API errors for forbidden CPIC writes", async () => {
  const proxy = createApiProxyTool({apiFetch: createClinpgxApiFetch(), catalog: clinpgxCatalog, stagingPrefix: "clinpgx"});
  expect(await proxy.handler({method: "POST", path: "/cpic/gene", body: {}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 405});
});
