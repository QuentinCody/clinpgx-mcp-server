import type {ApiCatalog} from "@bio-mcp/shared/codemode/catalog";
import {CPIC_RESOURCES} from "../lib/cpic";

export const cpicEndpoints: ApiCatalog["endpoints"] = [
  {method: "GET", path: "/cpic/bulk", category: "cpic", summary: "Discover the saved v1.60.0 PostgreSQL export, complete artifact SHA-256 and offline COPY-row SQLite importer. Application-only v1.60.1 has no database image. Does not download files or pin live API responses.",
    example: "await api.get('/cpic/bulk')"},
  {method: "GET", path: "/cpic/schema", category: "cpic", summary: "Discover CPIC's separate live PostgREST OpenAPI schema with response hash and observation time. Schema engine version is not a data release.",
    example: "await api.get('/cpic/schema')"},
  ...CPIC_RESOURCES.map(resource => ({
    method: "GET" as const, path: `/cpic/${resource}`, category: "cpic",
    summary: `Bounded read of CPIC ${resource}; returns native records plus _cpic provenance. Use schema discovery for current field names and native PostgREST operator filters. No automatic genotype interpretation.`,
    queryParams: [
      {name: "limit", type: "number" as const, required: false, default: 50, description: "Rows per page, 1–200. Embedded records also share the 4 MiB response cap."},
      {name: "offset", type: "number" as const, required: false, default: 0, description: "Nonnegative row offset, at most 1000000. Preserve Content-Range and ordering across pages."},
      {name: "order", type: "string" as const, required: false, description: "Native ordering over fields verified using the schema; include a stable unique tie-breaker."},
    ],
    example: `await api.get('/cpic/${resource}', {limit: 10, offset: 0})`,
  })),
];
