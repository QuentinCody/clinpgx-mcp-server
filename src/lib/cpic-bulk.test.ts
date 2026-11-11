import {afterEach, expect, it, vi} from "vitest";
import {createClinpgxApiFetch} from "./api-adapter";
import {clinpgxCatalog} from "../spec/catalog";

afterEach(() => vi.unstubAllGlobals());

it("discovers the saved artifact without fetching or relabeling the live API", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await createClinpgxApiFetch()({method: "GET", path: "/cpic/bulk"});
  expect(result).toMatchObject({status: 200, data: {
    artifact: {data_release: "v1.60.0", compressed_bytes: 3833028, fresh_download_verified: false,
      sha256: "1f02d87a492fffacb52a6d3ca5f45c5f7d6862bdfd382436d2cf7595b08d1ffe"},
    application_only_release: {version: "v1.60.1", database_image: false},
    _cpic: {api_version: null, current_data_release: null},
  }});
  expect(fetcher).not.toHaveBeenCalled();
  expect(clinpgxCatalog.endpoints.find(endpoint => endpoint.path === "/cpic/bulk")?.example).toBe("await api.get('/cpic/bulk')");
});

it.each([
  {method: "POST" as const},
  {method: "GET" as const, body: {}},
  {method: "GET" as const, params: {version: "v1.60.1"}},
  {method: "GET" as const, params: {limit: 1}},
])("rejects writes and invented artifact parameters: %j", async input => {
  vi.stubGlobal("fetch", vi.fn());
  await expect(createClinpgxApiFetch()({...input, path: "/cpic/bulk"})).rejects.toThrow(/discovery/);
  expect(fetch).not.toHaveBeenCalled();
});
