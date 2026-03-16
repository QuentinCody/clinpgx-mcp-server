/**
 * ClinPGx REST API v1 catalog for Code Mode.
 *
 * ClinPGx (formerly PharmGKB) integrates PharmGKB, CPIC, PharmCAT, and PharmVar
 * into a unified clinical pharmacogenomics resource.
 *
 * Covers ~28 endpoints across 10 categories:
 * genes, chemicals, variants, clinical_annotations, guideline_annotations,
 * labels, variant_annotations, pathways, literature, phenotypes
 *
 * ClinPGx response format: { data: [...], status: "success" }
 * Many list endpoints support view (min, max, base) plus offset/max pagination.
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const clinpgxCatalog: ApiCatalog = {
    name: "ClinPGx",
    baseUrl: "https://api.clinpgx.org/v1",
    version: "1.0.0",
    auth: "none",
    endpointCount: 28,
    notes:
        "- ClinPGx (formerly PharmGKB) — all pharmgkb.org URLs now redirect to clinpgx.org\n" +
        "- All list responses are wrapped in { data: [...], status: 'success' }. Access results via result.data\n" +
        "- Detail responses return { data: {object}, status: 'success' }\n" +
        "- Use 'view' param to control detail level: 'min' (IDs only), 'base' (default), 'max' (all cross-references)\n" +
        "- Many list endpoints use 'offset' (0-based) and 'max' (page size, default varies by endpoint)\n" +
        "- ClinPGx accession IDs look like PA12345 (genes), PA123456789 (drugs), PA166100001 (annotations)\n" +
        "- Gene symbols are case-sensitive (e.g., CYP2D6 not cyp2d6)\n" +
        "- Drug names are case-insensitive for search\n" +
        "- Rate limit: 2 requests/second\n" +
        "- /data/clinicalAnnotation does not support server-side evidence-level filtering; use levelOfEvidence client-side when needed\n" +
        "- Clinical annotation levels: 1A, 1B, 2A, 2B, 3, 4 (1A = highest evidence)\n" +
        "- Subresource URLs like /data/chemical/{id}/clinicalAnnotation do NOT work — the API treats them as property accessors.\n" +
        "  Use /data/clinicalAnnotation?relatedChemicals.name=DRUG or ?location.genes.symbol=GENE instead.\n" +
        "- Drug labels are at /data/drugLabel (not /data/label). Filter with relatedChemicals.name or relatedGenes.symbol.\n" +
        "- ClinPGx returns 404 for zero-result queries — the adapter normalizes this to { data: [], status: 'success' }.\n" +
        "- Guideline annotations include CPIC, DPWG, and PRO sources — filter with source param.\n" +
        "- Field renaming in progress: pharmgkbId → clinpgxId, pgkbCALevel → clinpgxLevel (API may return either).",
    endpoints: [
        // === Genes ===
        {
            method: "GET",
            path: "/data/gene",
            summary: "Search genes by symbol, name, or ClinPGx accession ID",
            category: "genes",
            coveredByTool: "clinpgx_gene_lookup",
            queryParams: [
                { name: "symbol", type: "string", required: false, description: "Gene symbol (e.g., CYP2D6, BRCA1, VKORC1)" },
                { name: "name", type: "string", required: false, description: "Gene name keyword search" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset (0-based)", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/gene/{accessionId}",
            summary: "Get detailed gene information by ClinPGx accession ID (e.g., PA131)",
            category: "genes",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Chemicals (Drugs) ===
        {
            method: "GET",
            path: "/data/chemical",
            summary: "Search chemicals/drugs by generic name or ClinPGx accession ID",
            category: "chemicals",
            coveredByTool: "clinpgx_drug_lookup",
            queryParams: [
                { name: "name", type: "string", required: false, description: "Drug generic name (e.g., warfarin, pembrolizumab). Trade names (e.g., Keytruda, Coumadin) will NOT match — use the generic name" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/chemical/{accessionId}",
            summary: "Get detailed chemical/drug information by ClinPGx accession ID (e.g., PA452625)",
            category: "chemicals",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Variants ===
        {
            method: "GET",
            path: "/data/variant",
            summary: "Search pharmacogenomic variants by gene symbol or rsID",
            category: "variants",
            queryParams: [
                { name: "location.genes.symbol", type: "string", required: false, description: "Filter by gene symbol (e.g., CYP2C19)" },
                { name: "name", type: "string", required: false, description: "Variant name or rsID (e.g., rs4244285)" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/variant/{accessionId}",
            summary: "Get detailed variant information by ClinPGx accession ID",
            category: "variants",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Clinical Annotations ===
        {
            method: "GET",
            path: "/data/clinicalAnnotation",
            summary: "Search clinical annotations — evidence linking genes/variants to drug response. Levels: 1A (highest) to 4",
            category: "clinical_annotations",
            coveredByTool: "clinpgx_clinical_annotations",
            queryParams: [
                { name: "location.genes.symbol", type: "string", required: false, description: "Filter by gene symbol (e.g., CYP2D6)" },
                { name: "relatedChemicals.name", type: "string", required: false, description: "Filter by drug name (e.g., codeine)" },
                { name: "location.variants.name", type: "string", required: false, description: "Filter by variant rsID (e.g., rs4244285)" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },
        {
            method: "GET",
            path: "/data/clinicalAnnotation/{id}",
            summary: "Get a specific clinical annotation by numeric ID",
            category: "clinical_annotations",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Guideline Annotations ===
        {
            method: "GET",
            path: "/data/guidelineAnnotation",
            summary: "Search CPIC/DPWG dosing guidelines — evidence-graded prescribing recommendations for pharmacogenomic-guided dosing",
            category: "guideline_annotations",
            coveredByTool: "clinpgx_guideline_annotations",
            queryParams: [
                { name: "source", type: "string", required: false, description: "Guideline source: cpic, dpwg, or pro" },
                { name: "relatedGenes.symbol", type: "string", required: false, description: "Filter by gene symbol (e.g., CYP2D6)" },
                { name: "relatedChemicals.name", type: "string", required: false, description: "Filter by drug name (e.g., codeine)" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/guidelineAnnotation/{id}",
            summary: "Get a specific CPIC/DPWG dosing guideline by ClinPGx ID — includes full prescribing recommendations",
            category: "guideline_annotations",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Drug Labels ===
        {
            method: "GET",
            path: "/data/drugLabel",
            summary: "Search FDA/EMA/PMDA/Health Canada drug labels with pharmacogenomic biomarker information",
            category: "labels",
            queryParams: [
                { name: "relatedChemicals.name", type: "string", required: false, description: "Filter by drug name (e.g., warfarin). Use generic name, not trade name" },
                { name: "relatedGenes.symbol", type: "string", required: false, description: "Filter by gene symbol (e.g., CYP2C9)" },
                { name: "source", type: "string", required: false, description: "Regulatory source: FDA, EMA, PMDA, HCSC" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/drugLabel/{id}",
            summary: "Get a specific drug label by ClinPGx ID — includes PGx biomarker details and regulatory annotations",
            category: "labels",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Variant Annotations ===
        {
            method: "GET",
            path: "/data/variantAnnotation",
            summary: "Search variant-level drug annotations — per-variant pharmacogenomic effects",
            category: "variant_annotations",
            queryParams: [
                { name: "location.genes.symbol", type: "string", required: false, description: "Filter by gene symbol (e.g., CYP2D6)" },
                { name: "location.variants.name", type: "string", required: false, description: "Filter by variant name or rsID" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/variantAnnotation/{id}",
            summary: "Get a specific variant annotation by ID",
            category: "variant_annotations",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Pathways ===
        {
            method: "GET",
            path: "/data/pathway",
            summary: "Search pharmacokinetic and pharmacodynamic pathways",
            category: "pathways",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/pathway/{accessionId}",
            summary: "Get detailed pathway information by ClinPGx accession ID",
            category: "pathways",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Literature ===
        {
            method: "GET",
            path: "/data/literature/{pmid}",
            summary: "Get ClinPGx literature annotation info for a PubMed article",
            category: "literature",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Diseases/Phenotypes ===
        {
            method: "GET",
            path: "/data/disease",
            summary: "Search diseases in ClinPGx (formerly phenotypes)",
            category: "diseases",
            queryParams: [
                { name: "name", type: "string", required: false, description: "Disease name (e.g., hypertension)" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/disease/{accessionId}",
            summary: "Get detailed disease information by ClinPGx accession ID",
            category: "diseases",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },
        // Legacy endpoint — some APIs still use /data/phenotype
        {
            method: "GET",
            path: "/data/phenotype",
            summary: "Search phenotypes/diseases in ClinPGx (legacy endpoint — prefer /data/disease)",
            category: "diseases",
            queryParams: [
                { name: "name", type: "string", required: false, description: "Phenotype/disease name" },
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/phenotype/{accessionId}",
            summary: "Get detailed phenotype/disease information by ClinPGx accession ID (legacy)",
            category: "diseases",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Automated Annotations ===
        {
            method: "GET",
            path: "/data/automatedAnnotation",
            summary: "Search automated (text-mined) annotations linking genes, drugs, and diseases",
            category: "automated_annotations",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
                { name: "offset", type: "number", required: false, description: "Pagination offset", default: 0 },
                { name: "max", type: "number", required: false, description: "Max results per page", default: 25 },
            ],
        },
        {
            method: "GET",
            path: "/data/automatedAnnotation/{id}",
            summary: "Get a specific automated annotation by ID",
            category: "automated_annotations",
            queryParams: [
                { name: "view", type: "string", required: false, description: "Detail level: min, base, max", default: "base" },
            ],
        },

        // === Reports ===
        {
            method: "GET",
            path: "/report/gene/{symbol}",
            summary: "Get comprehensive gene report by symbol (e.g., CYP2D6) — all annotations, guidelines, labels for a gene",
            category: "reports",
            queryParams: [],
        },
        {
            method: "GET",
            path: "/report/chemical/{accessionId}",
            summary: "Get comprehensive chemical/drug report by ClinPGx accession ID — all annotations, guidelines, labels",
            category: "reports",
            queryParams: [],
        },

        // NOTE: /data/gene/{id}/clinicalAnnotation does NOT work — ClinPGx API treats it as a property accessor.
        // Use /data/clinicalAnnotation?location.genes.symbol=GENE instead.
        // NOTE: /data/chemical/{id}/clinicalAnnotation does NOT work — ClinPGx API treats it as a property accessor.
        // Use /data/clinicalAnnotation?relatedChemicals.name=DRUGNAME instead.
        // NOTE: /data/variant/{id}/clinicalAnnotation does NOT work — ClinPGx API treats it as a property accessor.
        // Use /data/clinicalAnnotation with appropriate filters instead.
    ],
};
