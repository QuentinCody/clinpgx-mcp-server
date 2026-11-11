# Pinned CPIC COPY-row snapshots

`import_cpic.py` imports a local CPIC v1.60.0 PostgreSQL text dump into a new
SQLite file using only Python's standard library. It executes no source SQL and
makes no network requests. Discover the saved artifact through Code Mode:

```javascript
return await api.get('/cpic/bulk');
```

The [v1.60.0 release](https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.0)
links `https://files.cpicpgx.org/data/database/cpic_db_dump-v1.60.0.sql.gz`.
The [v1.60.1 release](https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.1)
changes application functions and supplies no database image. These identifiers
do not establish the version of a current API response.

The complete export saved on September 30, 2026 has compressed SHA-256
`1f02d87a492fffacb52a6d3ca5f45c5f7d6862bdfd382436d2cf7595b08d1ffe`.
Its 3,833,028 compressed bytes decode to 32,435,806 SQL bytes with SHA-256
`4efc5ed474524ae76f45ab3dfdea4312ffdc3061dee432c4f7aec32081e191e7`.
These are locally observed hashes, not publisher signatures. Fresh downloads
must match the chosen pin; a filename alone does not verify release identity.

From the repository root, after obtaining the export:

```bash
python3 servers/clinpgx-mcp-server/scripts/import_cpic.py \
  --input /path/to/cpic_db_dump-v1.60.0.sql.gz \
  --output /path/to/cpic-v1.60.0.sqlite \
  --sha256 1f02d87a492fffacb52a6d3ca5f45c5f7d6862bdfd382436d2cf7595b08d1ffe
```

The default bounds are 128 MiB compressed, 1 GiB decoded and 4 MiB per physical
line. Flags can set explicit alternative bounds. Hash mismatch, gzip corruption,
missing dump completion, malformed COPY rows, unsupported COPY modes/SQL,
invalid UTF-8 and exceeded bounds abort publication. Only canonical UTF-8,
LF-delimited pg_dump text COPY is accepted; CSV, binary, INSERT dumps and
physical multiline COPY fields are unsupported. String escapes follow
[PostgreSQL's text COPY rules](https://www.postgresql.org/docs/current/sql-copy.html#SQL-COPY-FILE-FORMATS).
Quoted function bodies and comments are distinguished from COPY statements.

The importer first copies and verifies the complete compressed input in a private
temporary directory beside the output. It parses that verified copy and publishes
the finished SQLite file atomically without replacing any existing destination.
The input may be elsewhere; the output directory must already exist. No prior
snapshot is mutated, including when another process creates the destination.

## Inspect and query

| SQLite object | Contents |
| --- | --- |
| `manifest` | Artifact identity, hashes, counts, import time and interpretation limits |
| `source_chunks` | Complete gzip bytes, ordered by `chunk_index`; concatenate to recover the original export |
| `copy_tables` | Exact source schema/table/ordered column names, row count and generated view name |
| `copy_rows` | One-based source row, JSON array of text/null cells, and exact original COPY line bytes |
| `data_0001`, … | One view per COPY table: `source_row`, then `c0`, `c1`, … in native column order |

Positional view columns preserve names that SQLite would otherwise fold or
rename. Native numeric, boolean, array, JSON and bytea representations remain
strings; NULL and empty string differ. Records are neither deduplicated nor
restricted to currently active pairs. No clinical meaning is inferred from
missing rows, `No Result`, normal function, a strength label or an activity score.
The full saved artifact has **24 tables, 586,283 rows and 3,021,596 cells**.
Every cell, COPY line, view value and compressed source byte was independently
compared after import.

For example, using SQLite with JSON functions, answer: **Which SLCO1B1 and ABCG2
drug pairs occur in this pinned CPIC snapshot, and which ClinPGx identifiers and
guidelines can be used for a separate annotation lookup?**

```sql
WITH records AS (
  SELECT t.table_name, r.row_index,
    (SELECT json_group_object(c.value,
        json_extract(r.cells_json, '$[' || c.key || ']'))
     FROM json_each(t.columns_json) AS c) AS record
  FROM copy_rows AS r JOIN copy_tables AS t USING (table_index)
  WHERE t.schema_name = 'cpic'
    AND t.table_name IN ('gene', 'drug', 'pair', 'guideline')
)
SELECT json_extract(p.record, '$.pairid') AS pair_id,
  json_extract(p.record, '$.genesymbol') AS gene,
  json_extract(g.record, '$.clinpgxid') AS gene_clinpgx_id,
  json_extract(d.record, '$.name') AS drug,
  json_extract(d.record, '$.clinpgxid') AS drug_clinpgx_id,
  json_extract(p.record, '$.cpiclevel') AS cpic_level,
  json_extract(p.record, '$.clinpgxlevel') AS clinpgx_level,
  json_extract(p.record, '$.removed') AS removed,
  json_extract(p.record, '$.guidelineid') AS guideline_id,
  json_extract(h.record, '$.clinpgxid') AS guideline_clinpgx_id
FROM records AS p
LEFT JOIN records AS g ON g.table_name = 'gene'
  AND json_extract(g.record, '$.symbol') = json_extract(p.record, '$.genesymbol')
LEFT JOIN records AS d ON d.table_name = 'drug'
  AND json_extract(d.record, '$.drugid') = json_extract(p.record, '$.drugid')
LEFT JOIN records AS h ON h.table_name = 'guideline'
  AND json_extract(h.record, '$.id') = json_extract(p.record, '$.guidelineid')
WHERE p.table_name = 'pair'
  AND json_extract(p.record, '$.genesymbol') IN ('SLCO1B1', 'ABCG2')
ORDER BY json_extract(p.record, '$.pairid');
```

Retain all rows and evidence fields before a separate ClinPGx annotation request.
The two sources do not form one immutable snapshot. The scalar guideline
`clinpgxid` is not the historical array of annotation IDs. This query discovers
research evidence and does not perform genotype translation or choose treatment.

PostgreSQL definitions, functions, constraints, views and sequence state remain
recoverable in the original compressed source but are **not executed or recreated**
in SQLite. This archive is not a PostgREST server or a replacement for CPIC's
translation functions. It is not connected to the Worker's temporary staging
database. A fresh provider read, PostgreSQL restore equivalence, clinical
validation and deployment remain separate acceptance work.

Run importer checks with:

```bash
python3 -m unittest discover -s servers/clinpgx-mcp-server/scripts -v
```
