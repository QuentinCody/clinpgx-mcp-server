import type {ApiFetchFn} from "@bio-mcp/shared/codemode/catalog";
import {cpicError} from "./cpic-http";

/** A saved provider artifact, not a claim about the current mutable API. */
export function cpicBulk(request: Parameters<ApiFetchFn>[0]): Awaited<ReturnType<ApiFetchFn>> {
  if (request.method !== "GET" || request.body !== undefined) cpicError("CPIC bulk discovery supports bodyless GET only", 405);
  if (Object.keys(request.params ?? {}).length) cpicError("CPIC bulk discovery does not accept filters or version overrides");
  return {status: 200, data: {
    artifact: {
      data_release: "v1.60.0",
      source_url: "https://files.cpicpgx.org/data/database/cpic_db_dump-v1.60.0.sql.gz",
      release_documentation: "https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.0",
      observed_at: "2026-09-30T17:36:17.441Z",
      compressed_bytes: 3833028,
      sha256: "1f02d87a492fffacb52a6d3ca5f45c5f7d6862bdfd382436d2cf7595b08d1ffe",
      decoded_sql_bytes: 32435806,
      decoded_sql_sha256: "4efc5ed474524ae76f45ab3dfdea4312ffdc3061dee432c4f7aec32081e191e7",
      hash_basis: "Complete saved provider response; locally computed, not a provider-signed checksum",
      fresh_download_verified: false,
    },
    application_only_release: {
      version: "v1.60.1", database_image: false,
      source_url: "https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.1",
    },
    local_ingestion: {
      script: "servers/clinpgx-mcp-server/scripts/import_cpic.py",
      storage: "New local SQLite file; complete compressed source and ordered COPY rows",
      arguments: ["--input", "--output", "--sha256"],
      scope: "Native text/null cells; PostgreSQL types, constraints, functions and API views are not materialized",
      execution: "Operator runs the offline importer; this route does not download or ingest files",
    },
    _cpic: {
      resource: "bulk", source_url: "https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.0",
      api_version: null, current_data_release: null, snapshot_is_atomic: false,
      interpretation: "Artifact identity is separate from live API/application version. No patient interpretation or clinical validation is inferred.",
    },
  }};
}
