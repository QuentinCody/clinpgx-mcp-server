# ClinPGx MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream ClinPGx API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://clinpgx-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "clinpgx": {
      "command": "npx",
      "args": ["mcp-remote", "https://clinpgx-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8813/mcp` (start it with `./scripts/dev-servers.sh clinpgx`):

```json
{
  "mcpServers": {
    "clinpgx-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8813/mcp"]
    }
  }
}
```

## Tools

- `clinpgx_search` — discover ClinPGx annotation and separate CPIC read operations
- `clinpgx_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `clinpgx_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `clinpgx_get_schema` — inspect the inferred schema of a staged dataset
- `clinpgx_clinical_annotations`
- `clinpgx_drug_lookup`
- `clinpgx_gene_lookup`
- `clinpgx_guideline_annotations`

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Development

```bash
./scripts/dev-servers.sh clinpgx            # run locally (port 8813)
pnpm --filter clinpgx-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

## ClinPGx and CPIC are separate API surfaces

This Worker currently routes to `https://api.clinpgx.org/v1`. The provider
[retired the PharmGKB API hostname on July 20, 2026](https://api.clinpgx.org/);
the Worker already uses the replacement. The separate CPIC database API remains
at `https://api.cpicpgx.org/v1/`. CPIC's website move does not move that API.
The local implementation routes `/cpic/schema` and the read resources below to
that separate host. Other catalog routes retain the ClinPGx host. CPIC writes and
RPCs are not exposed. All eight tools also have the `mcp_clinpgx_` aliases.

Use the existing ClinPGx capability for a bounded guideline-annotation preview:

```javascript
return await api.get('/data/guidelineAnnotation', {
  source: 'cpic',
  'relatedGenes.symbol': 'CYP2C19',
  'relatedChemicals.name': 'clopidogrel',
  view: 'max'
});
```

Keep the full response or staging handle, then inspect the staged schema before
querying it. This endpoint rejects `max`, `offset`, `page` and `limit`; narrow
the source/gene/drug filters instead. This annotation discovery does not translate a
diplotype into a recommendation, establish that every guideline was retrieved,
or prove that the search result applies to an individual. Keep publication,
guideline source, version, population and recommendation strength together.
ClinPGx's published limit is two requests per second; retry behavior alone does
not enforce that rate across concurrent calls.

## CPIC read integration — September 29, 2026

The [March 2026 migration notice](https://blog.clinpgx.org/updates-to-the-cpic-database-and-api/)
contains a semantic change as well as renames. CPIC `guideline.pharmgkbid` held
an array of annotation IDs; `guideline.clinpgxid` identifies one overall guideline.
Do not mechanically rename that array or join its former members to the new ID.
The gene/drug columns become `clinpgxid`, while pair evidence becomes
`clinpgxlevel`. These are CPIC database columns; they do not establish the JSON
field names of ClinPGx's annotation API. The catalog now distinguishes these
upstream contracts explicitly.

[CPIC 1.60.0](https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.0)
(August 8) includes data and allele-frequency changes, diplotype/phenotype handling
for genes without EHR priority, and ClinPGx RPC names. Its release links a versioned
database export. [1.60.1](https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.1)
(August 12) fixes database-function parameters and queries and explicitly provides
no new database image. Capture application/API and data-artifact versions separately;
do not construct a `1.60.1` database-download URL or label a live response as pinned
merely because that release exists.

The [published API schema](https://api.cpicpgx.org/) exposes useful read surfaces:

| Surface | Integration purpose |
| --- | --- |
| `/gene`, `/drug`, `/guideline`, `/pair_view` | Resolve source identifiers and retain guideline/evidence context |
| `/allele`, `/allele_definition`, `/diplotype`, `/gene_result`, `/gene_result_diplotype` | Inspect allele definitions and supported genotype-to-result mappings |
| `/recommendation_view` | Retrieve matching records with complete lookup keys and recommendation context |
| `/file_artifact`, `/file_artifact_history`, `/change_log_view` | Discover artifact history and changes where the live schema permits |
| `/allele_frequency`, `/population_frequency_view` | Inspect allele frequencies with their native population context |
| `/gene_result_lookup`, `/allele_guideline_view`, `/guideline_summary_view` | Inspect native result keys, allele/guideline links and guideline gene/drug summaries |

Prefix these provider resource names with `/cpic` in Code Mode. Reads default to
50 rows and permit 1–200 rows with an offset up to 1,000,000. The response reader
enforces a 20-second deadline and 4 MiB cap. Large Code Mode results stage at
30 KiB, preserving native records and the `_cpic` envelope in the lossless root.
Invalid responses and upstream errors remain failures, including CPIC 404s.

Discover current fields before building filters or selecting a stable unique
ordering. Schema retrieval can itself stage; use the returned handle and inspect
the staged schema. The OpenAPI engine version is not a CPIC data-release version.

```javascript
return await api.get('/cpic/schema');
```

After checking the current schema, preview the native recommendation rows:

```javascript
return await api.get('/cpic/recommendation_view', {
  drugname: 'eq.rosuvastatin', limit: 25, offset: 0
});
```

This preview is not ordered or exhaustive. For continued retrieval, choose a
schema-verified unique ordering, retain every page and its provenance, and check
the provider's range headers. Concurrent data changes can invalidate offset
pagination. `_cpic.pagination.completeness` remains `not_established`; even an
empty page does not establish absence of a clinically applicable guideline.
The adapter records the request URL, observation time, response-byte SHA-256,
Content-Range, ETag and Last-Modified. API/data release fields remain unknown;
independent requests do not constitute an atomic database snapshot.

The [CPIC maintainer's guidance](https://github.com/cpicpgx/cpic-data/issues/49)
recommends resolving diplotypes to gene results before querying recommendations,
rather than relying on `recommendation_lookup` for production translation. A
drug may depend on several genes; omitted inputs, explicit `No Result`, normal
function and unresolved calls are different states. Preserve all matches and
ambiguity. Do not silently substitute normal function, choose the first match,
or infer a complete lookup key from one gene. The historical RPC issue is a reason
to validate behavior, not proof that every current endpoint is broken.

Search `cpic translation` to discover the executable **CPIC diplotype evidence to
multi-gene recommendation matches** recipe. Its example uses the native key
`{"SLCO1B1":{"*15":1,"*37":1}}`, including both the gene wrapper and allele stars,
then combines the returned `lookupkey` with an explicitly supplied ABCG2
`No Result`. It uses native lookup keys rather than deriving them from display
phenotypes or activity-score labels. Every translation alternative and matching
page is retained. Missing, malformed, staged or excessive translation sets stop
for inspection; recommendation pages keep their continuation metadata and handles.
This bounded research recipe does not select a patient recommendation or establish
a complete, immutable result set.

September 30 live acceptance compares **26 direct CPIC responses** with the local
MCP Worker across schema discovery, all **18 read resources**, native diplotype
keys, explicit No Result versus omission, and ordered recommendation pagination.
Both the explicit-No-Result recipe and a two-gene translation example execute
successfully. An unknown allele stops before recommendation lookup. **99 MCP
calls** also verify complete 183,244-byte schema-envelope and 81,646-byte
recommendation-page recovery, chained staged pages with `api.query`, 60,000-character
SQL recovery, aliases and error paths. Whole MCP responses, including legacy tools
and SQL, stage when their UTF-8 size exceeds 30 KiB.

These checks establish the sampled provider/Worker contracts, not clinical
correctness. No automatic patient-specific recommendation is inferred by this adapter.

October 6 adds `/cpic/bulk` discovery and a [pinned local importer](scripts/README.md)
for the saved v1.60.0 export. It preserves all 24 native COPY tables, 586,283 rows
and 3,021,596 text/null cells in SQLite, together with the complete compressed
source. Every cell and original source byte passed independent comparison.
PostgreSQL functions, constraints and API views are retained as source SQL but
are not executed or recreated. This does not pin current API responses or
connect the local snapshot to Worker staging. Fresh download qualification,
PostgreSQL restore equivalence, clinical validation and deployment remain pending.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from ClinPGx (PharmGKB) + CPIC and stays under the terms of that source: ClinPGx/PharmGKB CC BY-SA 4.0, and its data usage policy says the data is not to be offered for sale as a commercial item; CPIC content CC0.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
