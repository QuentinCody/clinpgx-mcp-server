"""Import pg_dump COPY sections into a caller-owned SQLite transaction."""

import hashlib
import json
import re

from cpic_copy import SqlStatements, copy_header, copy_row


def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def make_schema(db):
    db.executescript("""
        CREATE TABLE source_chunks (chunk_index INTEGER PRIMARY KEY, bytes BLOB NOT NULL);
        CREATE TABLE manifest (json TEXT NOT NULL);
        CREATE TABLE copy_tables (
            table_index INTEGER PRIMARY KEY, schema_name TEXT NOT NULL,
            table_name TEXT NOT NULL, columns_json TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0, view_name TEXT NOT NULL,
            UNIQUE (schema_name, table_name)
        );
        CREATE TABLE copy_rows (
            table_index INTEGER NOT NULL, row_index INTEGER NOT NULL,
            cells_json TEXT NOT NULL, copy_bytes BLOB NOT NULL,
            PRIMARY KEY (table_index, row_index),
            FOREIGN KEY (table_index) REFERENCES copy_tables(table_index)
        ) WITHOUT ROWID;
    """)


class DumpReader:
    def __init__(self, db, max_bytes, max_line_bytes):
        self.db = db
        self.max_bytes = max_bytes
        self.max_line_bytes = max_line_bytes
        self.scanner = SqlStatements()
        self.table = None
        self.table_count = self.row_count = self.cell_count = self.sql_statements = 0
        self.byte_count = 0
        self.digest = hashlib.sha256()
        self.header = self.footer = self.encoding = self.strings = False
        self.restrict_key = None
        self.unrestricted = False

    def start_copy(self, statement):
        if not self.encoding or not self.strings or not self.scanner.idle:
            raise ValueError("COPY requires UTF8, standard strings and a standalone statement")
        schema, table, columns = copy_header(statement)
        self.table_count += 1
        if self.table_count > 4096:
            raise ValueError("Too many COPY tables")
        view = f"data_{self.table_count:04d}"
        self.db.execute("INSERT INTO copy_tables VALUES (?, ?, ?, ?, 0, ?)",
                        (self.table_count, schema, table, json_text(columns), view))
        # Positional column names avoid SQLite case folding, reserved names and
        # duplicate-label behavior. Native names remain in columns_json.
        projection = ", ".join(f"json_extract(cells_json, '$[{i}]') AS c{i}" for i in range(len(columns)))
        self.db.execute(f"CREATE VIEW {view} AS SELECT row_index AS source_row, {projection} "
                        f"FROM copy_rows WHERE table_index = {self.table_count}")
        self.table = (self.table_count, len(columns), 0)

    def statement(self, statement):
        verb = statement.split(None, 1)[0].upper()
        if verb == "COPY":
            self.start_copy(statement)
            return
        self.sql_statements += 1
        if verb not in {"SET", "SELECT", "CREATE", "ALTER", "COMMENT", "GRANT", "REVOKE"}:
            raise ValueError(f"Unsupported dump statement: {verb}")
        if re.match(r"SET\s+client_encoding\b", statement, re.I):
            if not re.fullmatch(r"SET\s+client_encoding\s*=\s*'UTF8'\s*;", statement, re.I):
                raise ValueError("Only UTF8 dumps are supported")
            self.encoding = True
        if re.match(r"SET\s+standard_conforming_strings\b", statement, re.I):
            if not re.fullmatch(r"SET\s+standard_conforming_strings\s*=\s*on\s*;", statement, re.I):
                raise ValueError("Only standard_conforming_strings=on is supported")
            self.strings = True
        if verb == "SELECT" and not re.fullmatch(
            r"SELECT\s+pg_catalog\.(?:set_config|setval)\([\s\S]*\)\s*;", statement, re.I
        ):
            raise ValueError("Only pg_dump sequence/search-path SELECT statements are supported")

    def data_line(self, line):
        table_index, width, count = self.table
        if line == b"\\.\n":
            self.db.execute("UPDATE copy_tables SET row_count = ? WHERE table_index = ?", (count, table_index))
            self.table = None
            return
        cells = copy_row(line, width)
        count += 1
        self.db.execute("INSERT INTO copy_rows VALUES (?, ?, ?, ?)",
                        (table_index, count, json_text(cells), line))
        self.table = (table_index, width, count)
        self.row_count += 1
        self.cell_count += width

    def directive(self, text):
        match = re.fullmatch(r"\\(restrict|unrestrict) ([A-Za-z0-9]+)\n", text)
        if not self.scanner.idle or not match:
            raise ValueError("Unsupported psql directive")
        command, key = match.groups()
        if command == "restrict" and self.restrict_key is None and not self.footer:
            self.restrict_key = key
        elif command == "unrestrict" and key == self.restrict_key and self.footer and not self.unrestricted:
            self.unrestricted = True
        else:
            raise ValueError("Invalid pg_dump restriction pair")

    def line(self, line):
        self.byte_count += len(line)
        if len(line) > self.max_line_bytes or self.byte_count > self.max_bytes:
            raise ValueError("Dump exceeds configured byte or line limit")
        self.digest.update(line)
        if self.table is not None:
            self.data_line(line)
            return
        text = line.decode("utf-8", errors="strict")
        if "\0" in text or "\r" in text:
            raise ValueError("Expected UTF8 pg_dump with LF line endings and no NUL")
        if self.scanner.idle:
            if text == "-- PostgreSQL database dump\n":
                if self.header:
                    raise ValueError("Repeated dump header")
                self.header = True
                return
            if text == "-- PostgreSQL database dump complete\n":
                if self.footer:
                    raise ValueError("Repeated dump footer")
                self.footer = True
                return
            if text.startswith("\\"):
                self.directive(text)
                return
        statements = self.scanner.feed(text)
        if self.footer and (statements or not self.scanner.idle):
            raise ValueError("SQL after dump completion marker")
        for statement in statements:
            if not self.header or self.table is not None:
                raise ValueError("Invalid COPY boundary or missing pg_dump header")
            self.statement(statement)

    def read(self, stream):
        while True:
            line = stream.readline(self.max_line_bytes + 1)
            if not line:
                break
            self.line(line)
        if (not self.header or not self.footer or not self.scanner.idle or self.table is not None
                or not self.table_count or (self.restrict_key is not None and not self.unrestricted)):
            raise ValueError("Incomplete pg_dump or missing COPY data sections")
        return {"sql_sha256": self.digest.hexdigest(), "sql_bytes": self.byte_count,
                "tables": self.table_count, "rows": self.row_count, "cells": self.cell_count,
                "unexecuted_sql_statements": self.sql_statements}
