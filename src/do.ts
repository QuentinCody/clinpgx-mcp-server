/**
 * ClinpgxDataDO — Durable Object for staging large ClinPGx responses.
 *
 * Extends RestStagingDO with ClinPGx-specific schema hints.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class ClinpgxDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                // ClinPGx objects have objCls, id, and name fields
                if ("type" in sample && "name" in sample && ("objCls" in sample || "id" in sample)) {
                    const objCls =
                        (sample as any).objCls || (sample as any).type || "data";
                    return {
                        tableName: String(objCls).toLowerCase().replace(/\s+/g, "_"),
                        indexes: ["id", "name"],
                    };
                }

                // Clinical annotations have location and level fields
                if ("location" in sample && "level" in sample) {
                    return {
                        tableName: "clinical_annotation",
                        indexes: ["id", "level"],
                    };
                }

                // Drug labels have drug and source fields
                if ("objCls" in sample && (sample as any).objCls === "Drug Label") {
                    return {
                        tableName: "drug_label",
                        indexes: ["id", "name"],
                    };
                }

                // Guideline annotations
                if ("objCls" in sample && (sample as any).objCls === "Guideline Annotation") {
                    return {
                        tableName: "guideline_annotation",
                        indexes: ["id", "name"],
                    };
                }

                // Variant annotations
                if ("objCls" in sample && (sample as any).objCls === "Variant Annotation") {
                    return {
                        tableName: "variant_annotation",
                        indexes: ["id"],
                    };
                }

                // Generic fallback for ClinPGx objects with id/name
                if ("id" in sample && "name" in sample) {
                    return {
                        tableName: "clinpgx_data",
                        indexes: ["id", "name"],
                    };
                }
            }
        }

        return undefined;
    }
}
