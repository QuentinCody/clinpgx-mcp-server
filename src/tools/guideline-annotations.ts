/**
 * clinpgx_guideline_annotations — Get CPIC/DPWG dosing guidelines.
 *
 * Fetches /data/guidelineAnnotation with filters for source, gene, and drug.
 * This is the clinically actionable layer — evidence-graded prescribing guidance.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clinpgxFetch } from "../lib/http";
import {
    shouldStage,
    stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface GuidelineAnnotationsEnv {
    CLINPGX_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

interface GuidelineAnnotation {
    id?: string;
    name?: string;
    objCls?: string;
    source?: string;
    relatedGenes?: Array<{ symbol?: string; name?: string }>;
    relatedChemicals?: Array<{ name?: string }>;
    [key: string]: unknown;
}

interface ClinPGxResponse {
    data?: GuidelineAnnotation[];
    status?: string;
}

export function registerGuidelineAnnotations(
    server: McpServer,
    env?: GuidelineAnnotationsEnv,
): void {
    server.registerTool(
        "clinpgx_guideline_annotations",
        {
            title: "ClinPGx Dosing Guidelines",
            description:
                "Get CPIC and DPWG dosing guidelines from ClinPGx — evidence-graded prescribing " +
                "recommendations for pharmacogenomic-guided dosing. When a clinician asks 'patient is " +
                "CYP2D6 poor metabolizer, what's the codeine dosing recommendation?' — this answers it. " +
                "Filter by guideline source (cpic/dpwg), gene symbol, or drug name.",
            inputSchema: {
                gene: z
                    .string()
                    .optional()
                    .describe(
                        "Gene symbol to filter guidelines by (e.g., CYP2D6, CYP2C19, VKORC1)",
                    ),
                drug: z
                    .string()
                    .optional()
                    .describe(
                        "Drug name to filter guidelines by (e.g., codeine, warfarin, clopidogrel)",
                    ),
                source: z
                    .enum(["cpic", "dpwg", "pro"])
                    .optional()
                    .describe(
                        "Guideline source: cpic (Clinical Pharmacogenetics Implementation Consortium), dpwg (Dutch Pharmacogenetics Working Group), pro (PharmGKB)",
                    ),
            },
        },
        async (rawArgs, extra) => {
            const envToUse = env || (extra as { env?: Record<string, unknown> })?.env;
            try {
                const {
                    gene,
                    drug,
                    source,
                } = rawArgs as {
                    gene?: string;
                    drug?: string;
                    source?: string;
                };

                const params: Record<string, unknown> = { view: "max" };
                if (gene) params["relatedGenes.symbol"] = gene;
                if (drug) params["relatedChemicals.name"] = drug;
                if (source) params["source"] = source;

                const response = await clinpgxFetch(
                    "/data/guidelineAnnotation",
                    params,
                );

                if (!response.ok) {
                    if (response.status === 404) {
                        const body = await response.text().catch(() => "");
                        if (body.includes("No results matching criteria")) {
                            const filterDesc = [
                                gene ? `gene=${gene}` : "",
                                drug ? `drug=${drug}` : "",
                                source ? `source=${source}` : "",
                            ]
                                .filter(Boolean)
                                .join(", ");
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text: `No dosing guidelines found for ${filterDesc || "these criteria"}.`,
                                    },
                                ],
                                structuredContent: {
                                    success: true,
                                    data: {
                                        filters: { gene, drug, source },
                                        total: 0,
                                        results: [],
                                    },
                                    _meta: { fetched_at: new Date().toISOString() },
                                },
                            };
                        }
                    }
                    const body = await response.text().catch(() => "");
                    throw new Error(
                        `ClinPGx API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`,
                    );
                }

                const json = (await response.json()) as ClinPGxResponse;
                const guidelines = json.data ?? [];

                const filterDesc = [
                    gene ? `gene=${gene}` : "",
                    drug ? `drug=${drug}` : "",
                    source ? `source=${source}` : "",
                ]
                    .filter(Boolean)
                    .join(", ");

                if (guidelines.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `No dosing guidelines found for ${filterDesc || "these criteria"}.`,
                            },
                        ],
                        structuredContent: {
                            success: true,
                            data: {
                                filters: { gene, drug, source },
                                total: 0,
                                results: [],
                            },
                            _meta: { fetched_at: new Date().toISOString() },
                        },
                    };
                }

                const responseData = {
                    filters: { gene, drug, source },
                    total: guidelines.length,
                    results: guidelines,
                    fetched_at: new Date().toISOString(),
                };

                // Stage if large
                const responseBytes = JSON.stringify(responseData).length;
                if (shouldStage(responseBytes) && envToUse?.CLINPGX_DATA_DO) {
                    try {
                        const sessionId = (extra as { sessionId?: string })?.sessionId;
                        const staged = await stageToDoAndRespond(
                            guidelines,
                            envToUse.CLINPGX_DATA_DO as DurableObjectNamespace,
                            "guideline_annotation",
                            undefined,
                            undefined,
                            "clinpgx",
                            sessionId,
                        );
                        const text = `Found ${guidelines.length} dosing guideline(s) for ${filterDesc || "all"}. Data staged (${staged.totalRows ?? 0} rows). Use clinpgx_query_data with data_access_id '${staged.dataAccessId}'.`;
                        return {
                            content: [{ type: "text" as const, text }],
                            structuredContent: {
                                success: true,
                                data: {
                                    staged: true,
                                    data_access_id: staged.dataAccessId,
                                    filters: { gene, drug, source },
                                    total: guidelines.length,
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
                const guidelineSummaries = guidelines.slice(0, 10).map((g) => {
                    const genes = g.relatedGenes?.map((gn) => gn.symbol).join(", ") ?? "?";
                    const drugs = g.relatedChemicals?.map((c) => c.name).join(", ") ?? "?";
                    const src = g.source ?? "?";
                    return `[${src}] ${genes} / ${drugs} — ${g.name ?? "Untitled"} (ID: ${g.id ?? "?"})`;
                });

                const text =
                    `Found ${guidelines.length} dosing guideline(s) for ${filterDesc || "all"}:\n` +
                    guidelineSummaries.join("\n") +
                    (guidelines.length > 10
                        ? `\n... and ${guidelines.length - 10} more`
                        : "");

                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: {
                        success: true,
                        data: responseData,
                        _meta: {
                            fetched_at: new Date().toISOString(),
                            total: guidelines.length,
                        },
                    },
                };
            } catch (error) {
                const msg =
                    error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        { type: "text" as const, text: `Error: ${msg}` },
                    ],
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
