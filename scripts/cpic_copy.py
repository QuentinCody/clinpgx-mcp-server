"""Read the text COPY subset emitted by pg_dump, without executing any SQL."""

import re


IDENTIFIER = r'(?:[a-zA-Z_][a-zA-Z_0-9$]*|"(?:[^"]|"")+")'
COPY = re.compile(
    rf'COPY\s+({IDENTIFIER})\.({IDENTIFIER})\s*\(\s*'
    rf'({IDENTIFIER}(?:\s*,\s*{IDENTIFIER})*)\s*\)\s+FROM\s+stdin\s*;',
    re.IGNORECASE,
)


def identifier(value):
    return value[1:-1].replace('""', '"') if value.startswith('"') else value.lower()


def copy_header(statement):
    match = COPY.fullmatch(statement.strip())
    if not match:
        raise ValueError("Only schema-qualified default text COPY FROM stdin is supported")
    schema, table, columns = match.groups()
    names = [identifier(m.group()) for m in re.finditer(IDENTIFIER, columns)]
    if len(names) != len(set(names)) or len(names) > 1600:
        raise ValueError("Duplicate or excessive COPY columns")
    return identifier(schema), identifier(table), names


def copy_value(raw):
    """Decode escapes as bytes before strict UTF-8; never coerce native values."""
    if raw == b"\\N":
        return None
    result = bytearray()
    index = 0
    escapes = {98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11}
    while index < len(raw):
        char = raw[index]
        index += 1
        if char != 92:
            result.append(char)
            continue
        if index == len(raw):
            raise ValueError("Incomplete COPY escape; physical multiline fields are unsupported")
        char = raw[index]
        index += 1
        if char in b"01234567":
            end = index
            while end < min(index + 2, len(raw)) and raw[end] in b"01234567":
                end += 1
            value = int(raw[index - 1:end], 8)
            if value > 255:
                raise ValueError("COPY octal escape exceeds a byte")
            result.append(value)
            index = end
        elif char == 120 and index < len(raw) and raw[index] in b"0123456789abcdefABCDEF":
            end = index + 1
            if end < len(raw) and raw[end] in b"0123456789abcdefABCDEF":
                end += 1
            result.append(int(raw[index:end], 16))
            index = end
        else:
            result.append(escapes.get(char, char))
    if 0 in result:
        raise ValueError("NUL is not a PostgreSQL text value")
    return result.decode("utf-8", errors="strict")


def copy_row(line, width):
    if not line.endswith(b"\n") or b"\r" in line:
        raise ValueError("Expected canonical pg_dump LF-delimited COPY row")
    fields = line[:-1].split(b"\t")
    if len(fields) != width:
        raise ValueError("COPY row width does not match its column list")
    return [copy_value(value) for value in fields]


class SqlStatements:
    """Small lexical scanner: quoted function bodies cannot introduce COPY rows.

    This splits statements, not SQL semantics. Non-COPY SQL is retained in the
    source archive, never sent to SQLite, PostgreSQL, a shell or a network API.
    """

    def __init__(self, max_chars=4 * 1024 * 1024):
        self.parts = []
        self.quote = None
        self.escape = False
        self.comment_depth = 0
        self.size = 0
        self.max_chars = max_chars

    @property
    def idle(self):
        return not self.parts and self.quote is None and self.comment_depth == 0

    def append(self, value):
        self.parts.append(value)
        self.size += len(value)
        if self.size > self.max_chars:
            raise ValueError("SQL statement exceeds parser limit")

    def feed(self, line):
        output = []
        index = 0
        while index < len(line):
            char = line[index]
            pair = line[index:index + 2]
            if self.comment_depth:
                if pair == "/*":
                    self.comment_depth += 1
                    index += 2
                elif pair == "*/":
                    self.comment_depth -= 1
                    index += 2
                else:
                    index += 1
                continue
            if self.quote:
                token = self.quote
                if line.startswith(token, index):
                    self.append(token)
                    index += len(token)
                    if token in ("'", '"') and line.startswith(token, index):
                        self.append(token)
                        index += 1
                    else:
                        self.quote = None
                elif self.escape and char == "\\":
                    self.append(line[index:index + 2])
                    index += 2
                else:
                    self.append(char)
                    index += 1
                continue
            if pair == "--":
                break
            if pair == "/*":
                if self.parts:
                    self.append(" ")
                self.comment_depth = 1
                index += 2
                continue
            if char in ("'", '"'):
                prefix = "".join(self.parts[-2:])
                self.escape = char == "'" and bool(re.search(r"(?:^|\W)[eE]$", prefix))
                self.quote = char
            elif char == "$":
                match = re.match(r"\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$", line[index:])
                if match:
                    self.quote = match.group()
                    self.escape = False
                    self.append(self.quote)
                    index += len(self.quote)
                    continue
            if char == ";":
                self.append(char)
                output.append("".join(self.parts).strip())
                self.parts = []
                self.size = 0
            elif self.parts or not char.isspace():
                self.append(char)
            index += 1
        if self.parts and self.quote is None:
            self.append("\n")
        return output
