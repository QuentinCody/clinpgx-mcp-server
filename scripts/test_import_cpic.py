"""Run with python3 -m unittest discover -s servers/clinpgx-mcp-server/scripts."""

import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from cpic_copy import copy_header, copy_row, copy_value
from import_cpic import copy_archive, import_dump


PREFIX = (b"--\n-- PostgreSQL database dump\n--\n\\restrict Key123\n"
          b"SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n")
SUFFIX = b"-- PostgreSQL database dump complete\n\\unrestrict Key123\n"
ROWS = (b"COPY cpic.gene (symbol, version, note) FROM stdin;\n"
        b"CYP2D6\t001.2300\t\\N\nCYP2D6\t001.2300\t\n"
        b"ABCG2\t9007199254740993\tNo Result\n\\.\n")


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "dump.sql.gz"
        self.output = self.root / "snapshot.sqlite"

    def prepare(self, data=PREFIX + ROWS + SUFFIX):
        content = gzip.compress(data, mtime=0)
        self.source.write_bytes(content)
        return hashlib.sha256(content).hexdigest()

    def failure(self, data, message, **limits):
        digest = self.prepare(data)
        with self.assertRaisesRegex((ValueError, sqlite3.Error), message):
            import_dump(self.source, self.output, digest, **limits)
        self.assertFalse(self.output.exists())
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["dump.sql.gz"])

    def test_native_cells_and_complete_archive_survive_sql(self):
        digest = self.prepare()
        result = import_dump(self.source, self.output, digest)
        self.assertEqual((result["tables"], result["rows"], result["cells"]), (1, 3, 9))
        self.assertEqual(result["sql_sha256"], hashlib.sha256(PREFIX + ROWS + SUFFIX).hexdigest())
        with sqlite3.connect(self.output) as db:
            self.assertEqual(db.execute("SELECT * FROM data_0001 ORDER BY source_row").fetchall(), [
                (1, "CYP2D6", "001.2300", None), (2, "CYP2D6", "001.2300", ""),
                (3, "ABCG2", "9007199254740993", "No Result"),
            ])
            compressed = b"".join(row[0] for row in db.execute("SELECT bytes FROM source_chunks ORDER BY chunk_index"))
            self.assertEqual(compressed, self.source.read_bytes())
            self.assertEqual(json.loads(db.execute("SELECT json FROM manifest").fetchone()[0]), result)
            self.assertEqual(db.execute("SELECT copy_bytes FROM copy_rows WHERE row_index = 2").fetchone()[0],
                             b"CYP2D6\t001.2300\t\n")
        self.assertIsNone(result["current_live_api_version"])
        self.assertFalse(result["clinical_validation"])

    def test_empty_table_and_repeated_rows_retained(self):
        content = PREFIX + ROWS + b"COPY cpic.empty (id) FROM stdin;\n\\.\n" + SUFFIX
        result = import_dump(self.source, self.output, self.prepare(content))
        self.assertEqual(result["tables"], 2)
        with sqlite3.connect(self.output) as db:
            self.assertEqual(db.execute("SELECT row_count FROM copy_tables ORDER BY table_index").fetchall(), [(3,), (0,)])
            self.assertEqual(db.execute("SELECT count(*) FROM data_0002").fetchone()[0], 0)

    def test_case_sensitive_and_reserved_column_names_preserved(self):
        content = PREFIX + b'COPY "cpic"."Gene" ("A", a, "source_row", "quo""te", "x,y") FROM stdin;\n1\t2\t3\t4\t5\n\\.\n' + SUFFIX
        import_dump(self.source, self.output, self.prepare(content))
        with sqlite3.connect(self.output) as db:
            names = json.loads(db.execute("SELECT columns_json FROM copy_tables").fetchone()[0])
            self.assertEqual(names, ["A", "a", "source_row", 'quo"te', "x,y"])
            self.assertEqual(db.execute("SELECT * FROM data_0001").fetchone(), (1, "1", "2", "3", "4", "5"))

    def test_function_bodies_comments_and_strings_cannot_add_copy_sections(self):
        decoys = b'''CREATE FUNCTION cpic.fake() RETURNS text AS $body$
COPY cpic.wrong (id) FROM stdin;
-- PostgreSQL database dump complete
\\unrestrict Key123
$body$ LANGUAGE sql;
/* outer /* COPY */ nested */
COMMENT ON SCHEMA cpic IS 'COPY cpic.nope (a) FROM stdin; it''s a comment';
COMMENT ON SCHEMA cpic IS E'escaped\\' quote; COPY cpic.nope (a) FROM stdin;';
'''
        result = import_dump(self.source, self.output, self.prepare(PREFIX + decoys + ROWS + SUFFIX))
        self.assertEqual((result["tables"], result["rows"]), (1, 3))
        self.assertEqual(result["unexecuted_sql_statements"], 5)

    def test_wrong_pin_fails_before_decompression(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            import_dump(self.source, self.output, "0" * 64)
        self.assertFalse(self.output.exists())

    def test_pin_and_limits_validated(self):
        for digest in ("", "a" * 63, "A" * 64, "x" * 64):
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                import_dump(self.source, self.output, digest)
        for limit in (0, -1, True, 1.5):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                import_dump(self.source, self.output, "a" * 64, max_sql_bytes=limit)

    def test_all_byte_limits_abort_without_publishing(self):
        for key in ("max_compressed_bytes", "max_sql_bytes", "max_line_bytes"):
            with self.subTest(key=key):
                self.failure(PREFIX + ROWS + SUFFIX, "limit", **{key: 10})

    def test_existing_output_is_never_overwritten(self):
        self.output.write_bytes(b"earlier snapshot")
        with self.assertRaises(FileExistsError):
            import_dump(self.source, self.output, self.prepare())
        self.assertEqual(self.output.read_bytes(), b"earlier snapshot")

    def test_publication_race_preserves_new_destination(self):
        original = os.link

        def race(source, target):
            Path(target).write_bytes(b"another publisher")
            original(source, target)

        with patch("import_cpic.os.link", side_effect=race), self.assertRaises(FileExistsError):
            import_dump(self.source, self.output, self.prepare())
        self.assertEqual(self.output.read_bytes(), b"another publisher")

    def test_parse_uses_verified_private_copy_when_input_changes(self):
        digest = self.prepare()

        def change_source(*args):
            count = copy_archive(*args)
            self.source.write_bytes(b"replacement")
            return count

        with patch("import_cpic.copy_archive", side_effect=change_source):
            result = import_dump(self.source, self.output, digest)
        self.assertEqual(result["source_sha256"], digest)
        self.assertEqual(result["rows"], 3)

    def test_truncated_gzip_and_bad_crc_do_not_publish(self):
        for mutation in (lambda x: x[:-4], lambda x: x[:-8] + b"\0" * 8):
            self.prepare()
            self.source.write_bytes(mutation(self.source.read_bytes()))
            digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
            with self.subTest(mutation=mutation), self.assertRaises((OSError, EOFError)):
                import_dump(self.source, self.output, digest)
            self.assertFalse(self.output.exists())

    def test_incomplete_dumps_are_rejected(self):
        for data in (PREFIX + ROWS, ROWS + SUFFIX, PREFIX + SUFFIX,
                     PREFIX + ROWS.replace(b"\\.\n", b""), PREFIX + ROWS + SUFFIX.replace(b"Key123", b"bad"),
                     PREFIX + ROWS + SUFFIX + b"SELECT 1;\n", PREFIX + ROWS + SUFFIX + PREFIX):
            with self.subTest(data=data[-50:]):
                self.failure(data, "Incomplete|missing|restriction|completion|Repeated")

    def test_unsupported_sql_and_copy_options_fail(self):
        for statement in (b"INSERT INTO cpic.gene VALUES ('x');\n",
                          b"COPY cpic.gene (id) FROM stdin WITH (FORMAT csv);\n",
                          b"COPY cpic.gene TO PROGRAM 'anything';\n",
                          b"\\include /etc/passwd\n", b"SELECT malicious();\n",
                          b"COPY cpic.gene (id) FROM stdin; SELECT 1;\n"):
            with self.subTest(statement=statement):
                self.failure(PREFIX + statement + ROWS + SUFFIX, "Unsupported|Only|Invalid")

    def test_non_utf8_or_nonstandard_strings_fail(self):
        for data in (PREFIX.replace(b"UTF8", b"LATIN1"), PREFIX.replace(b"= on", b"= off")):
            self.failure(data + ROWS + SUFFIX, "Only")
        self.failure(PREFIX + ROWS.replace(b"No Result", b"\xff") + SUFFIX, "decode")

    def test_duplicate_table_sections_and_misaligned_rows_fail(self):
        self.failure(PREFIX + ROWS + ROWS + SUFFIX, "UNIQUE")
        self.failure(PREFIX + ROWS.replace(b"CYP2D6\t001.2300\t\\N", b"missing") + SUFFIX, "width")

    def test_unclosed_sql_lexical_states_fail(self):
        for trailing in (b"/* missing end\n", b"CREATE FUNCTION f() AS $$missing\n", b"COMMENT ON SCHEMA cpic IS 'missing\n"):
            self.failure(PREFIX + ROWS + trailing + SUFFIX, "Incomplete")


class CopyTests(unittest.TestCase):
    def test_escape_decoding_and_null_distinction(self):
        self.assertIsNone(copy_value(b"\\N"))
        self.assertEqual(copy_value(b"\\\\N"), "\\N")
        self.assertEqual(copy_value(b""), "")
        self.assertEqual(copy_value(b"\\b\\f\\n\\r\\t\\v\\\\\\q"), "\b\f\n\r\t\v\\q")
        self.assertEqual(copy_value(b"\\303\\251\\xE2\\x82\\xAC"), "é€")
        self.assertEqual(copy_value(b"\\x7a\\172\\12"), "zz\n")

    def test_numbers_json_arrays_and_bytea_remain_strings(self):
        values = [b"0.000000000000000001", b"9007199254740993", b'{"ABCG2":"No Result"}',
                  b'{"*15","*37"}', b"\\\\x4142", "β Δ".encode()]
        self.assertEqual(copy_row(b"\t".join(values) + b"\n", 6),
                         ["0.000000000000000001", "9007199254740993", '{"ABCG2":"No Result"}',
                          '{"*15","*37"}', "\\x4142", "β Δ"])

    def test_malformed_escapes_and_noncanonical_lines_fail(self):
        for value in (b"\\", b"\\000", b"\\777", b"\\xff", b"\0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                copy_value(value)
        for row in (b"x", b"x\r\n", b"x\\\n"):
            with self.subTest(row=row), self.assertRaises(ValueError):
                copy_row(row, 1)

    def test_column_identifiers_are_validated(self):
        self.assertEqual(copy_header('COPY cpic."Gene" (a, "B") FROM stdin;'), ("cpic", "Gene", ["a", "B"]))
        for statement in ("COPY cpic.gene (a, a) FROM stdin;", "COPY gene (a) FROM stdin;",
                          "COPY cpic.gene (a) FROM '/tmp/x';", "COPY cpic.gene (a) FROM stdin; DROP TABLE x;"):
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                copy_header(statement)


if __name__ == "__main__":
    unittest.main()
