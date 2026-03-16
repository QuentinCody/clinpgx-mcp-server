/**
 * clinpgx_clinical_annotations — Get clinical annotations for gene/drug combinations.
 *
 * Fetches /data/clinicalAnnotation with filters for gene symbol, drug name,
 * variant rsID, and evidence level. May return many results — uses staging for large responses.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clinpgxFetch } from "../lib/http";
import {
    shouldStage,
    stageToDoAndRespond,
} from "@bio-mcp/shared/staging/utils";

interface ClinicalAnnotationsEnv {
    CLINPGX_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

interface ClinicalAnnotation {
    id?: number;
    level?: string;
    type?: string;
    location?: { genes?: Array<{ symbol?: string }>; variants?: Array<{ name?: string }> };
    relatedChemicals?: Array<{ name?: string }>;
    phenotypes?: Array<{ name?: string }>;
    [key: string]: unknown;
}

interface ClinPGxResponse {
    data?: ClinicalAnnotation[];
    status?: string;
}

export function registerClinicalAnnotations(
    server: McpServer,
    env?: ClinicalAnnotationsEnv,
) {
    server.registerTool(
        "clinpgx_clinical_annotations",
        {
            title: "ClinPGx Clinical Annotations",
            description:
                "Get clinical annotations from ClinPGx that link genetic variants to drug response. " +
                "Filter by gene symbol, drug name, variant rsID, and/or evidence level (1A highest to 4 lowest). " +
                "Returns variant-drug-phenotype associations with clinical significance.",
            inputSchema: {
                gene: z
                    .string()
                    .optional()
                    .describe(
                        "Gene symbol to filter by (e.g., CYP2D6, CYP2C19, VKORC1)",
                    ),
                drug: z
                    .string()
                    .optional()
                    .describe(
                        "Drug name to filter by (e.g., warfarin, codeine, clopidogrel)",
                    ),
                variant: z
                    .string()
                    .optional()
                    .describe(
                        "Variant rsID to filter by (e.g., rs4244285)",
                    ),
                level: z
                    .enum(["1A", "1B", "2A", "2B", "3", "4"])
                    .optional()
                    .describe(
                        "Evidence level filter: 1A (highest, CPIC guideline), 1B, 2A, 2B, 3, 4 (lowest)",
                    ),
            },
        },
        async (rawArgs, extra) => {
            const envToUse = env || (extra as any)?.env;
            try {
                const {
                    gene,
                    drug,
                    variant,
                    level,
                } = rawArgs as {
                    gene?: string;
                    drug?: string;
                    variant?: string;
                    level?: string;
                };

                if (!gene && !drug && !variant) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: "Error: At least one filter must be provided: gene, drug, or variant.",
                            },
                        ],
                        isError: true,
                        structuredContent: {
                            success: false,
                            error: {
                                code: "INVALID_ARGUMENTS",
                                message:
                                    "At least one filter must be provided: gene, drug, or variant.",
                            },
                        },
                    };
                }

                const params: Record<string, unknown> = {};
                if (gene) params["location.genes.symbol"] = gene;
                if (drug) params["relatedChemicals.name"] = drug;
                if (variant) params["location.variants.name"] = variant;

                const response = await clinpgxFetch(
                    "/data/clinicalAnnotation",
                    params,
                );

                if (!response.ok) {
                    // ClinPGx returns 404 "No results matching criteria" for zero-result queries — normalize to empty
                    if (response.status === 404) {
                        const body = await response.text().catch(() => "");
                        if (body.includes("No results matching criteria")) {
                            const filterDesc = [
                                gene ? `gene=${gene}` : "",
                                drug ? `drug=${drug}` : "",
                                variant ? `variant=${variant}` : "",
                                level ? `level=${level}` : "",
                            ]
                                .filter(Boolean)
                                .join(", ");
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text: `No clinical annotations found for ${filterDesc}.`,
                                    },
                                ],
                                structuredContent: {
                                    success: true,
                                    data: {
                                        filters: { gene, drug, variant, level },
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
                let annotations = json.data ?? [];

                // Client-side level filter (API uses 'levelOfEvidence', not filterable server-side)
                if (level) {
                    annotations = annotations.filter(
                        (a) => (a as any).levelOfEvidence === level,
                    );
                }

                const filterDesc = [
                    gene ? `gene=${gene}` : "",
                    drug ? `drug=${drug}` : "",
                    variant ? `variant=${variant}` : "",
                    level ? `level=${level}` : "",
                ]
                    .filter(Boolean)
                    .join(", ");

                if (annotations.length === 0) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `No clinical annotations found for ${filterDesc}.`,
                            },
                        ],
                        structuredContent: {
                            success: true,
                            data: {
                                filters: { gene, drug, variant, level },
                                total: 0,
                                results: [],
                            },
                            _meta: { fetched_at: new Date().toISOString() },
                        },
                    };
                }

                const responseData = {
                    filters: { gene, drug, variant, level },
                    total: annotations.length,
                    results: annotations,
                    fetched_at: new Date().toISOString(),
                };

                // Stage if large
                const responseBytes = JSON.stringify(responseData).length;
                if (shouldStage(responseBytes) && envToUse?.CLINPGX_DATA_DO) {
                    try {
                        const sessionId = (extra as { sessionId?: string })?.sessionId;
                        const staged = await stageToDoAndRespond(
                            annotations,
                            envToUse.CLINPGX_DATA_DO as any,
                            "clinical_annotation",
                            undefined,
                            undefined,
                            "clinpgx",
                            sessionId,
                        );
                        const text = `Found ${annotations.length} clinical annotation(s) for ${filterDesc}. Data staged (${staged.totalRows ?? 0} rows). Use clinpgx_query_data with data_access_id '${staged.dataAccessId}'.`;
                        return {
                            content: [{ type: "text" as const, text }],
                            structuredContent: {
                                success: true,
                                data: {
                                    staged: true,
                                    data_access_id: staged.dataAccessId,
                                    filters: { gene, drug, variant, level },
                                    total: annotations.length,
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
                const annotationSummaries = annotations.slice(0, 10).map((a) => {
                    const genes =
                        a.location?.genes?.map((g) => g.symbol).join(", ") ?? "?";
                    const drugs =
                        a.relatedChemicals?.map((c) => c.name).join(", ") ?? "?";
                    const phenotypes =
                        a.phenotypes?.map((p) => p.name).join(", ") ?? "";
                    return `[Level ${(a as any).levelOfEvidence ?? "?"}] ${genes} / ${drugs}${phenotypes ? ` - ${phenotypes}` : ""} (ID: ${a.id ?? "?"})`;
                });

                const text =
                    `Found ${annotations.length} clinical annotation(s) for ${filterDesc}:\n` +
                    annotationSummaries.join("\n") +
                    (annotations.length > 10
                        ? `\n... and ${annotations.length - 10} more`
                        : "");

                return {
                    content: [{ type: "text" as const, text }],
                    structuredContent: {
                        success: true,
                        data: responseData,
                        _meta: {
                            fetched_at: new Date().toISOString(),
                            total: annotations.length,
                            returned: annotations.length,
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
