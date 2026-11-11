import {afterEach, expect, it, vi} from "vitest";
import {readCpic} from "./cpic-http";
const url = new URL("https://api.cpicpgx.org/v1/gene?limit=1&offset=0");
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});
it("retains raw-byte identity and version/range headers", async () => {
  const raw = '[{"symbol":"CYP2C19","note":"α"}]';
  const fetcher = vi.fn().mockResolvedValue(new Response(raw, {headers: {"Content-Type": "application/json", "Content-Range": "0-0/*", ETag: '"opaque"', "Last-Modified": "Wed, 12 Aug 2026 00:00:00 GMT"}}));
  vi.stubGlobal("fetch", fetcher);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const expectedHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  expect(await readCpic(url)).toMatchObject({data: JSON.parse(raw), sha256: expectedHash, headers: {content_range: "0-0/*", etag: '"opaque"'}});
  expect(fetcher).toHaveBeenCalledWith(url.toString(), expect.objectContaining({method: "GET", redirect: "manual", signal: expect.any(AbortSignal)}));
});
it.each([400, 404, 429, 500])("keeps provider HTTP %i as an error, never empty evidence", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider diagnostic", {status})));
  await expect(readCpic(url)).rejects.toMatchObject({status, message: `CPIC HTTP ${status}`});
});
it.each([
  new Response("<html>failure</html>", {headers: {"Content-Type": "text/html"}}),
  new Response("{", {headers: {"Content-Type": "application/json"}}),
  new Response(new Uint8Array([255]), {headers: {"Content-Type": "application/json"}}),
  new Response(null, {headers: {"Content-Type": "application/json"}}),
  new Response("x".repeat(4 * 1024 * 1024 + 1), {headers: {"Content-Type": "application/json"}}),
])("rejects invalid or oversized provider content %#", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(readCpic(url)).rejects.toMatchObject({status: 502});
});
it("bounds a stalled fetch", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  const result = expect(readCpic(url)).rejects.toMatchObject({status: 504});
  await vi.advanceTimersByTimeAsync(20001); await result;
});
it("bounds a stalled body even when stream cancellation never settles", async () => {
  vi.useFakeTimers();
  const body = new ReadableStream({pull: () => new Promise(() => {}), cancel: () => new Promise(() => {})});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {headers: {"Content-Type": "application/json"}})));
  const result = expect(readCpic(url)).rejects.toMatchObject({status: 504});
  await vi.advanceTimersByTimeAsync(20001); await result;
});
it("sanitizes network diagnostics", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("internal connection detail")));
  await expect(readCpic(url)).rejects.toMatchObject({status: 502, message: "CPIC request failed"});
});
