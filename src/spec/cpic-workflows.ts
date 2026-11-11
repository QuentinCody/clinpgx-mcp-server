import type {WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";

export const cpicWorkflows: WorkflowRecipe[] = [{
  title: "CPIC diplotype evidence to multi-gene recommendation matches",
  description: "Bounded research example for rosuvastatin. Input allele names must match the live diplotype schema, including stars; null explicitly means No Result. Retains every translation alternative, native recommendation page and provenance. Stops for inspection on missing, malformed, staged or oversized translation sets. Does not infer missing genes, choose a recommendation or establish a pinned snapshot. Recommendation pages retain continuation metadata; inspect staged pages using api.query.",
  keywords: ["cpic", "diplotype", "phenotype", "translation", "rosuvastatin", "SLCO1B1", "ABCG2", "No Result"],
  code: `const inputs = {SLCO1B1: {"*15": 1, "*37": 1}, ABCG2: null};
const translations = [];
let keys = [{}];
for (const [gene, alleles] of Object.entries(inputs)) {
  if (alleles === null) {
    keys = keys.map(key => ({...key, [gene]: "No Result"}));
    continue;
  }
  const page = await api.get('/cpic/diplotype', {
    genesymbol: 'eq.' + gene,
    diplotypekey: 'eq.' + JSON.stringify({[gene]: alleles}),
    select: 'genesymbol,diplotype,diplotypekey,lookupkey,generesult,totalactivityscore',
    order: 'diplotype.asc', limit: 200, offset: 0
  });
  translations.push({gene, page});
  if (!Array.isArray(page.records) || !page.records.length || page.records.length === 200) {
    return {status: 'translation_requires_inspection', translations, matches: []};
  }
  const alternatives = [];
  for (const row of page.records) {
    if (row.genesymbol !== gene || !row.lookupkey || Object.keys(row.lookupkey).length !== 1 || typeof row.lookupkey[gene] !== 'string') {
      return {status: 'translation_requires_inspection', translations, matches: []};
    }
    alternatives.push(row.lookupkey);
  }
  if (keys.length * alternatives.length > 25) {
    return {status: 'translation_requires_inspection', translations, matches: []};
  }
  keys = keys.flatMap(key => alternatives.map(other => ({...key, ...other})));
}
const matches = [];
for (const key of keys) {
  const page = await api.get('/cpic/recommendation_view', {
    drugname: 'eq.rosuvastatin', lookupkey: 'cd.' + JSON.stringify(key),
    order: 'recommendationid.asc', limit: 50, offset: 0
  });
  matches.push({lookupkey: key, page});
}
return {status: 'evidence_pages', inputs, translations, matches, snapshot_is_atomic: false};`,
}];
