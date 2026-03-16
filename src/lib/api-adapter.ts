/**
 * ClinPGx API adapter — wraps clinpgxFetch into the ApiFetchFn interface
 * for use by the Code Mode execute tool.
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { clinpgxFetch } from "./http";

/**
 * Create an ApiFetchFn that routes through clinpgxFetch.
 * No auth needed — ClinPGx REST API is public for read access.
 */
export function createClinpgxApiFetch(): ApiFetchFn {
    return async (request) => {
        const response = await clinpgxFetch(
            request.path,
            request.params as Record<string, unknown>,
        );

        if (!response.ok) {
            // ClinPGx returns 404 "No results matching criteria" for zero-result queries — normalize to empty
            if (response.status === 404) {
                const body = await response.text().catch(() => "");
                if (body.includes("No results matching criteria")) {
                    return {
                        status: 200,
                        data: { data: [], status: "success" },
                    };
                }
            }
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
