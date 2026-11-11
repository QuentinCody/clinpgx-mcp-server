import type {ApiFetchFn} from "@bio-mcp/shared/codemode/catalog";
import {cpicError, readCpic} from "./cpic-http";
import {cpicBulk} from "./cpic-bulk";

export const CPIC_RESOURCES = ["gene", "drug", "guideline", "pair_view", "allele", "allele_definition",
  "diplotype", "gene_result", "gene_result_diplotype", "recommendation_view", "file_artifact",
  "file_artifact_history", "change_log_view", "allele_frequency", "population_frequency_view",
  "gene_result_lookup", "allele_guideline_view", "guideline_summary_view"] as const;

function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) cpicError("Invalid CPIC pagination value");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) cpicError("Invalid CPIC pagination value");
  return number;
}

function requestUrl(request: Parameters<ApiFetchFn>[0]): {url: URL; resource: string; limit: number; offset: number} {
  if (request.method !== "GET" || request.body !== undefined) cpicError("CPIC routes support GET reads only", 405);
  const resource = request.path.slice("/cpic/".length);
  if (resource !== "schema" && !CPIC_RESOURCES.some(name => name === resource)) cpicError("Unsupported CPIC resource", 404);
  const params = request.params ?? {};
  const limit = integer(params.limit, 50, 200);
  const offset = integer(params.offset, 0, 1000000);
  if (limit < 1) cpicError("CPIC limit must be between 1 and 200");
  const url = new URL(resource === "schema" ? "https://api.cpicpgx.org/v1/" : `https://api.cpicpgx.org/v1/${resource}`);
  if (resource === "schema") {
    if (Object.keys(params).length) cpicError("Schema discovery does not accept filters");
    return {url, resource, limit, offset};
  }
  if (Object.keys(params).length > 30) cpicError("Too many CPIC query parameters");
  for (const [key, value] of Object.entries(params)) {
    if (key === "limit" || key === "offset") continue;
    if (!/^[a-z][a-z0-9_]*$/.test(key) || key.length > 100 || typeof value !== "string" || value.length > 8000) cpicError("CPIC filters must be bounded native field/operator strings");
    url.searchParams.set(key, value);
  }
  url.searchParams.set("limit", String(limit)); url.searchParams.set("offset", String(offset));
  if (url.toString().length > 16000) cpicError("CPIC query is too large");
  return {url, resource, limit, offset};
}

function validate(data: unknown, schema: boolean): void {
  if (schema) {
    if (!data || typeof data !== "object" || Array.isArray(data) || !("paths" in data) || !data.paths || typeof data.paths !== "object" || Array.isArray(data.paths)) cpicError("Invalid CPIC OpenAPI document", 502);
    return;
  }
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) cpicError("Invalid CPIC table response", 502);
}

export async function cpicRead(request: Parameters<ApiFetchFn>[0]): Promise<Awaited<ReturnType<ApiFetchFn>>> {
  if (request.path === "/cpic/bulk") return cpicBulk(request);
  const {url, resource, limit, offset} = requestUrl(request);
  const result = await readCpic(url);
  validate(result.data, resource === "schema");
  const count = Array.isArray(result.data) ? result.data.length : null;
  if (count !== null && count > limit) cpicError("CPIC exceeded the requested row limit", 502);
  return {status: result.status, data: {
    ...(resource === "schema" ? {schema: result.data} : {records: result.data}),
    _cpic: {
      source_url: url.toString(), resource, observed_at: new Date().toISOString(), response_sha256: result.sha256,
      headers: result.headers, api_version: null, data_release: null, snapshot_is_atomic: false,
      pagination: resource === "schema" ? null : {limit, offset, returned: count, content_range: result.headers.content_range,
        completeness: "not_established", next_offset_candidate: count ? offset + count : null},
      interpretation: "Native source evidence only. Retain all matches, populations, strengths and lookup keys. Missing input is not normal function; explicit No Result is not an omitted value. No automatic genotype translation or patient-specific recommendation is inferred.",
    },
  }};
}
