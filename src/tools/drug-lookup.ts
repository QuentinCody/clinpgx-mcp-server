/**
 * clinpgx_drug_lookup — Search drugs by name in ClinPGx.
 *
 * Fetches /data/chemical?name={name}&view=max and returns drug details
 * with cross-references, dosing guidelines, and label annotations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clinpgxFetch } from "../lib/http";
import {
    shouldStage,
    stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface DrugLookupEnv {
    CLINPGX_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

interface ClinPGxDrug {
    id?: string;
    name?: string;
    objCls?: string;
    genericNames?: string[];
    tradeNames?: string[];
    crossReferences?: unknown[];
    dosageGuidelines?: unknown[];
    [key: string]: unknown;
}

interface ClinPGxResponse {
    data?: ClinPGxDrug[];
    status?: string;
}

export function registerDrugLookup(server: McpServer, env?: DrugLookupEnv): void {
    server.registerTool(
        "clinpgx_drug_lookup",
        {
            title: "ClinPGx Drug Lookup",
            description:
                "Search ClinPGx for pharmacogenomic drug information by drug name. " +
                "Returns drug details including generic/trade names, cross-references " +
                "to DrugBank, RxNorm, ATC, and links to dosing guidelines and drug labels.",
            inputSchema: {
                name: z
                    .string()
                    .min(1)
                    .describe(
                        "Drug name to search for (e.g., warfarin, clopidogrel, imatinib, codeine)",
                    ),
            },
        },
        async (rawArgs, extra) => {
            const envToUse = env || (extra as { env?: Record<string, unknown> })?.env;
            try {
                const { name } = rawArgs as { name: string };

                // Try direct drug lookup first (ClinPGx uses /data/chemical instead of /data/drug)
                const response = await clinpgxFetch("/data/chemical", {
                    name,
                    view: "max",
                });

                let json: ClinPGxResponse;
                let drugs: ClinPGxDrug[];

                if (response.ok) {
                    json = (await response.json()) as ClinPGxResponse;
                    drugs = json.data ?? [];
                } else {
                    // Direct lookup failed — fallback to search endpoint
                    drugs = [];
                }

                // If no results from direct lookup, try search endpoint
                if (drugs.length === 0) {
                    const searchResponse = await clinpgxFetch("/data/search", {
                        query: name,
                        objectType: "Chemical",
                    });
                    if (searchResponse.ok) {
                        const searchJson = (await searchResponse.json()) as { data?: Array<{ obj?: Record<string, unknown> }> };
                        const searchResults = searchJson.data ?? [];
                        for (const result of searchResults) {
                            if (result.obj && (result.obj.objCls === "Chemical" || result.obj.objCls === "Drug")) {
                                drugs.push(result.obj as ClinPGxDrug);
                            }
                        }
                    }
                }

                if (drugs.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `No drugs found in ClinPGx for "${name}".`,
                            },
                        ],
                        structuredContent: {
                            success: true,
                            data: { query: name, total: 0, results: [] },
                            _meta: { fetched_at: new Date().toISOString() },
                        },
                    };
                }

                const responseData = {
                    query: name,
                    total: drugs.length,
                    results: drugs,
                    fetched_at: new Date().toISOString(),
                };

                // Stage if large
                const responseBytes = JSON.stringify(responseData).length;
                if (shouldStage(responseBytes) && envToUse?.CLINPGX_DATA_DO) {
                    try {
                        const sessionId = (extra as { sessionId?: string })?.sessionId;
                        const staged = await stageToDoAndRespond(
                            drugs,
                            envToUse.CLINPGX_DATA_DO as DurableObjectNamespace,
                            "clinpgx_drug",
                            undefined,
                            undefined,
                            "clinpgx",
                            sessionId,
                        );
                        const text = `Found ${drugs.length} drug(s) for "${name}". Data staged (${staged.totalRows ?? 0} rows). Use clinpgx_query_data with data_access_id '${staged.dataAccessId}'.`;
                        return {
                            content: [{ type: "text" as const, text }],
                            structuredContent: {
                                success: true,
                                data: {
                                    staged: true,
                                    data_access_id: staged.dataAccessId,
                                    query: name,
                                    total: drugs.length,
                                    tables_created: staged.tablesCreated,
                                    total_rows: staged.totalRows,
                                },
                                _meta: {
                                    fetched_at: new Date().toISOString(),
                                    staged: true,
                                    data_access_id: staged.dataAccessId,
                                },
                                _staging: staged._staging,
                            },
                        };
                    } catch {
                        // fall through to inline
                    }
                }

                // Build summary text
                const drugSummaries = drugs.map((d) => {
                    const parts = [`${d.name ?? "Unknown"} (${d.id ?? "no ID"})`];
                    if (d.genericNames?.length) {
                        parts.push(`Generic: ${d.genericNames.join(", ")}`);
                    }
                    if (d.tradeNames?.length) {
                        parts.push(`Trade: ${d.tradeNames.slice(0, 5).join(", ")}${d.tradeNames.length > 5 ? "..." : ""}`);
                    }
                    if (d.dosageGuidelines && Array.isArray(d.dosageGuidelines)) {
                        parts.push(`Dosing guidelines: ${d.dosageGuidelines.length}`);
                    }
                    return parts.join(" | ");
                });

                const text = `Found ${drugs.length} drug(s) for "${name}":\n${drugSummaries.join("\n")}`;

                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: {
                        success: true,
                        data: responseData,
                        _meta: {
                            fetched_at: new Date().toISOString(),
                            total: drugs.length,
                        },
                    },
                };
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text" as const, text: `Error: ${msg}` }],
                    isError: true,
                    structuredContent: {
                        success: false,
                        error: { code: "API_ERROR", message: msg },
                    },
                };
            }
        },
    );
}
