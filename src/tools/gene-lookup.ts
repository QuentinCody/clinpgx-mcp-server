/**
 * clinpgx_gene_lookup — Search genes by symbol, get pharmacogenomic details.
 *
 * Fetches /data/gene?symbol={symbol}&view=max and returns gene details
 * with cross-references and clinical annotation counts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clinpgxFetch } from "../lib/http";
import {
    shouldStage,
    stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface GeneLookupEnv {
    CLINPGX_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

interface ClinPGxGene {
    id?: string;
    name?: string;
    symbol?: string;
    objCls?: string;
    crossReferences?: unknown[];
    clinicalAnnotationCount?: number;
    [key: string]: unknown;
}

interface ClinPGxResponse {
    data?: ClinPGxGene[];
    status?: string;
}

export function registerGeneLookup(server: McpServer, env?: GeneLookupEnv) {
    server.registerTool(
        "clinpgx_gene_lookup",
        {
            title: "ClinPGx Gene Lookup",
            description:
                "Search ClinPGx for pharmacogenomic gene information by gene symbol. " +
                "Returns gene details including cross-references to NCBI, Ensembl, HGNC, " +
                "and counts of clinical annotations linking the gene to drug response.",
            inputSchema: {
                symbol: z
                    .string()
                    .min(1)
                    .describe(
                        "Gene symbol to search for (e.g., CYP2D6, BRCA1, VKORC1, CYP2C19)",
                    ),
            },
        },
        async (rawArgs, extra) => {
            const envToUse = env || (extra as any)?.env;
            try {
                const { symbol } = rawArgs as { symbol: string };

                const response = await clinpgxFetch("/data/gene", {
                    symbol,
                    view: "max",
                });

                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    throw new Error(
                        `ClinPGx API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`,
                    );
                }

                const json = (await response.json()) as ClinPGxResponse;
                const genes = json.data ?? [];

                if (genes.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `No genes found in ClinPGx for symbol "${symbol}".`,
                            },
                        ],
                        structuredContent: {
                            success: true,
                            data: { query: symbol, total: 0, results: [] },
                            _meta: { fetched_at: new Date().toISOString() },
                        },
                    };
                }

                const responseData = {
                    query: symbol,
                    total: genes.length,
                    results: genes,
                    fetched_at: new Date().toISOString(),
                };

                // Stage if large
                const responseBytes = JSON.stringify(responseData).length;
                if (shouldStage(responseBytes) && envToUse?.CLINPGX_DATA_DO) {
                    try {
                        const sessionId = (extra as { sessionId?: string })?.sessionId;
                        const staged = await stageToDoAndRespond(
                            genes,
                            envToUse.CLINPGX_DATA_DO as any,
                            "clinpgx_gene",
                            undefined,
                            undefined,
                            "clinpgx",
                            sessionId,
                        );
                        const text = `Found ${genes.length} gene(s) for "${symbol}". Data staged (${staged.totalRows ?? 0} rows). Use clinpgx_query_data with data_access_id '${staged.dataAccessId}'.`;
                        return {
                            content: [{ type: "text" as const, text }],
                            structuredContent: {
                                success: true,
                                data: {
                                    staged: true,
                                    data_access_id: staged.dataAccessId,
                                    query: symbol,
                                    total: genes.length,
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
                const geneSummaries = genes.map((g) => {
                    const parts = [`${g.symbol ?? g.name ?? "Unknown"} (${g.id ?? "no ID"})`];
                    if (g.name && g.name !== g.symbol) parts.push(`Name: ${g.name}`);
                    if (g.clinicalAnnotationCount) {
                        parts.push(`Clinical annotations: ${g.clinicalAnnotationCount}`);
                    }
                    return parts.join(" | ");
                });

                const text = `Found ${genes.length} gene(s) for "${symbol}":\n${geneSummaries.join("\n")}`;

                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: {
                        success: true,
                        data: responseData,
                        _meta: {
                            fetched_at: new Date().toISOString(),
                            total: genes.length,
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
