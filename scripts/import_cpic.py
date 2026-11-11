#!/usr/bin/env python3
"""Create a pinned, offline CPIC COPY-row archive. No network or SQL execution."""

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile

from cpic_dump import DumpReader, json_text, make_schema


EXPORT_URL = "https://files.cpicpgx.org/data/database/cpic_db_dump-v1.60.0.sql.gz"
RELEASE_URL = "https://github.com/cpicpgx/cpic-data/releases/tag/v1.60.0"


def copy_archive(source, target, db, expected_sha256, max_bytes):
    digest = hashlib.sha256()
    size = 0
    with Path(source).open("rb") as reader, target.open("xb") as writer:
        index = 0
        while True:
            chunk = reader.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise ValueError("Compressed archive exceeds configured byte limit")
            digest.update(chunk)
            writer.write(chunk)
            db.execute("INSERT INTO source_chunks VALUES (?, ?)", (index, chunk))
            index += 1
    if digest.hexdigest() != expected_sha256:
        raise ValueError("Compressed archive SHA-256 does not match the required pin")
    return size


def import_dump(source, output, sha256, *, max_compressed_bytes=128 * 1024 * 1024,
                max_sql_bytes=1024 * 1024 * 1024, max_line_bytes=4 * 1024 * 1024):
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("A lowercase, 64-character SHA-256 pin is required")
    for limit in (max_compressed_bytes, max_sql_bytes, max_line_bytes):
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
            raise ValueError("Byte limits must be positive integers")
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError("Output already exists; choose a new snapshot path")
    with tempfile.TemporaryDirectory(prefix=".cpic-import-", dir=output.parent) as directory:
        directory = Path(directory)
        private_archive = directory / "source.sql.gz"
        temporary_db = directory / "snapshot.sqlite"
        db = sqlite3.connect(temporary_db)
        try:
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("PRAGMA synchronous = FULL")
            make_schema(db)
            compressed_bytes = copy_archive(source, private_archive, db, sha256, max_compressed_bytes)
            with gzip.open(private_archive, "rb") as stream:
                counts = DumpReader(db, max_sql_bytes, max_line_bytes).read(stream)
            manifest = {
                "format": "cpic-copy-snapshot-v1", "declared_data_release": "v1.60.0",
                "declared_source_url": EXPORT_URL, "release_documentation": RELEASE_URL,
                "source_authenticity": "not_established_by_local_hash",
                "current_live_api_version": None, "clinical_validation": False,
                "source_sha256": sha256, "compressed_bytes": compressed_bytes,
                "imported_at": datetime.now(timezone.utc).isoformat(), **counts,
                "scope": "All COPY rows in the pinned artifact; strings/nulls and source order retained",
                "not_materialized": ["PostgreSQL types", "constraints", "functions", "views", "API behavior"],
                "source_retention": "Complete compressed artifact in source_chunks, original COPY lines in copy_rows",
            }
            db.execute("INSERT INTO manifest VALUES (?)", (json_text(manifest),))
            db.commit()
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("SQLite integrity check failed")
        finally:
            db.close()
        with temporary_db.open("rb") as reader:
            os.fsync(reader.fileno())
        # Same-filesystem link atomically publishes a complete file and refuses
        # an existing destination, including a destination created during import.
        os.link(temporary_db, output)
        directory_fd = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Local v1.60.0 pg_dump .sql.gz")
    parser.add_argument("--output", required=True, type=Path, help="New SQLite snapshot; never overwritten")
    parser.add_argument("--sha256", required=True, help="Expected SHA-256 of the complete compressed export")
    parser.add_argument("--max-compressed-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--max-sql-bytes", type=int, default=1024 * 1024 * 1024)
    parser.add_argument("--max-line-bytes", type=int, default=4 * 1024 * 1024)
    args = parser.parse_args()
    try:
        manifest = import_dump(args.input, args.output, args.sha256,
                               max_compressed_bytes=args.max_compressed_bytes,
                               max_sql_bytes=args.max_sql_bytes, max_line_bytes=args.max_line_bytes)
    except (OSError, ValueError, EOFError, sqlite3.Error) as error:
        parser.exit(1, f"CPIC import failed: {error}\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
