/**
 * clinpgx_drug_lookup — Search drugs by name in ClinPGx.
 *
 * Fetches /data/chemical?name={name}&view=max and returns drug details
 * with cross-references, dosing guidelines, and label annotations.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
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

/** A non-OK upstream status other than 404 (404 is real absence). */
interface UpstreamFailure {
    endpoint: string;
    status: number;
}

type StagedResult = Awaited<ReturnType<typeof stageToDoAndRespond>>;

interface DrugResponseData {
    query: string;
    total: number;
    results: ClinPGxDrug[];
    fetched_at: string;
}

/** Direct lookup (ClinPGx uses /data/chemical instead of /data/drug). */
async function fetchDrugsByName(
    name: string,
    failures: UpstreamFailure[],
): Promise<ClinPGxDrug[]> {
    const response = await clinpgxFetch("/data/chemical", {
        name,
        view: "max",
    });
    if (response.ok) {
        const json = (await response.json()) as ClinPGxResponse;
        return json.data ?? [];
    }
    // Direct lookup failed — caller falls back to the search endpoint
    if (response.status !== 404) {
        failures.push({ endpoint: "/data/chemical", status: response.status });
    }
    return [];
}

/** Search fallback: keeps only Chemical/Drug objects from /data/search. */
async function fetchDrugsBySearch(
    name: string,
    failures: UpstreamFailure[],
): Promise<ClinPGxDrug[]> {
    const searchResponse = await clinpgxFetch("/data/search", {
        query: name,
        objectType: "Chemical",
    });
    const drugs: ClinPGxDrug[] = [];
    if (searchResponse.ok) {
        const searchJson = (await searchResponse.json()) as { data?: Array<{ obj?: Record<string, unknown> }> };
        const searchResults = searchJson.data ?? [];
        for (const result of searchResults) {
            if (result.obj && (result.obj.objCls === "Chemical" || result.obj.objCls === "Drug")) {
                drugs.push(result.obj as ClinPGxDrug);
            }
        }
    } else if (searchResponse.status !== 404) {
        failures.push({ endpoint: "/data/search", status: searchResponse.status });
    }
    return drugs;
}

/** Direct lookup, then search fallback when the direct lookup yields nothing. */
async function collectDrugs(
    name: string,
): Promise<{ drugs: ClinPGxDrug[]; upstreamFailures: UpstreamFailure[] }> {
    const upstreamFailures: UpstreamFailure[] = [];
    let drugs = await fetchDrugsByName(name, upstreamFailures);
    if (drugs.length === 0) {
        drugs = await fetchDrugsBySearch(name, upstreamFailures);
    }
    return { drugs, upstreamFailures };
}

/** No drug found and some path failed: an upstream error, not absence. */
function buildUpstreamErrorResult(name: string, upstreamFailures: UpstreamFailure[]) {
    const detail = upstreamFailures
        .map((f) => `${f.endpoint} HTTP ${f.status}`)
        .join(", ");
    const msg = `ClinPGx upstream request failed for "${name}" (${detail}); absence of results is not confirmed.`;
    return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
        structuredContent: {
            success: false,
            error: {
                code: "UPSTREAM_ERROR",
                message: msg,
                status: upstreamFailures[upstreamFailures.length - 1].status,
                upstream_failures: upstreamFailures,
            },
        },
    };
}

function buildEmptyResult(name: string) {
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

function buildStagedResult(name: string, drugs: ClinPGxDrug[], staged: StagedResult) {
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
}

/** Stage large responses to the DO; undefined means "respond inline". */
async function tryStageDrugs(
    name: string,
    drugs: ClinPGxDrug[],
    responseData: DrugResponseData,
    envToUse: { CLINPGX_DATA_DO?: unknown } | undefined,
    extra: unknown,
) {
    const responseBytes = JSON.stringify(responseData).length;
    if (!shouldStage(responseBytes) || !envToUse?.CLINPGX_DATA_DO) return undefined;
    try {
        const sessionId = (extra as Record<string, unknown>);
        const staged = await stageToDoAndRespond(
            drugs,
            envToUse.CLINPGX_DATA_DO as DurableObjectNamespace,
            "clinpgx_drug",
            undefined,
            undefined,
            "clinpgx",
            sessionId,
        );
        return buildStagedResult(name, drugs, staged);
    } catch {
        /* best-effort: fall through to inline */
        return undefined;
    }
}

function summarizeDrug(d: ClinPGxDrug): string {
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
}

function buildInlineResult(name: string, drugs: ClinPGxDrug[], responseData: DrugResponseData) {
    const text = `Found ${drugs.length} drug(s) for "${name}":\n${drugs.map(summarizeDrug).join("\n")}`;
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
}

function buildApiErrorResult(error: unknown) {
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

async function handleDrugLookup(rawArgs: unknown, extra: unknown, env?: DrugLookupEnv) {
    const envToUse = env || (extra as { env?: Record<string, unknown> })?.env;
    try {
        const { name } = rawArgs as { name: string };
        const { drugs, upstreamFailures } = await collectDrugs(name);
        if (drugs.length === 0 && upstreamFailures.length > 0) {
            return buildUpstreamErrorResult(name, upstreamFailures);
        }
        if (drugs.length === 0) return buildEmptyResult(name);
        const responseData: DrugResponseData = {
            query: name,
            total: drugs.length,
            results: drugs,
            fetched_at: new Date().toISOString(),
        };
        const staged = await tryStageDrugs(name, drugs, responseData, envToUse, extra);
        return staged ?? buildInlineResult(name, drugs, responseData);
    } catch (error) {
        return buildApiErrorResult(error);
    }
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
        async (rawArgs, extra) => handleDrugLookup(rawArgs, extra, env),
    );
}
