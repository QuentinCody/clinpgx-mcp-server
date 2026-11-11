export function cpicError(message: string, status = 400): never {
  throw Object.assign(new Error(message), {status});
}

async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 4 * 1024 * 1024) cpicError("CPIC response exceeds 4 MiB; narrow the query", 502);
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function decode(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
  catch { cpicError("CPIC returned invalid JSON", 502); }
}

/** One bounded read; no authentication or patient data is attached by this client. */
export async function readCpic(url: URL): Promise<{data: unknown; sha256: string; status: number; headers: {content_range: string | null; etag: string | null; last_modified: string | null}}> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("CPIC request exceeded 20 seconds"), {status: 504}));
    }, 20000);
  });
  const receive = async () => {
    const response = await fetch(url.toString(), {method: "GET", redirect: "manual", signal: controller.signal,
      headers: {Accept: "application/json, application/openapi+json", "User-Agent": "clinpgx-mcp-server/1.0 (bio-mcp)"}});
    if (!response.ok) {
      void response.body?.cancel().catch(() => {}); // Best-effort cleanup must not delay the HTTP error.
      cpicError(`CPIC HTTP ${response.status}`, response.status);
    }
    if (!response.headers.get("content-type")?.includes("json")) {
      void response.body?.cancel().catch(() => {}); // Preserve the format failure if cancellation stalls.
      cpicError("CPIC returned non-JSON content", 502);
    }
    reader = response.body?.getReader();
    if (!reader) cpicError("CPIC returned an empty body", 502);
    const bytes = await readBytes(reader);
    const data = decode(bytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    return {data, sha256, status: response.status, headers: {
      content_range: response.headers.get("content-range"),
      etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified"),
    }};
  };
  try { return await Promise.race([receive(), timeout]); }
  catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    return cpicError("CPIC request failed", 502);
  } finally {
    clearTimeout(timer); controller.abort();
    // Never await cancellation: a stalled upstream must not extend the deadline.
    void reader?.cancel().catch(() => {}); // Best-effort cleanup after the request verdict.
  }
}
