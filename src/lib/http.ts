/**
 * ClinPGx REST API HTTP client.
 *
 * Wraps restFetch from @bio-mcp/shared with the ClinPGx v1 base URL.
 * ClinPGx (formerly PharmGKB) API is at api.clinpgx.org/v1.
 * Rate limit: 2 requests/second.
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const CLINPGX_BASE = "https://api.clinpgx.org/v1";

export async function clinpgxFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: Partial<RestFetchOptions>,
): Promise<Response> {
    return restFetch(CLINPGX_BASE, path, params, {
        ...opts,
        headers: {
            Accept: "application/json",
            ...(opts?.headers ?? {}),
        },
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "clinpgx-mcp-server/1.0 (bio-mcp)",
    });
}
