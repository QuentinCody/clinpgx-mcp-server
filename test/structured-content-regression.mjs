#!/usr/bin/env node

/**
 * Regression tests for ClinPGx MCP server structuredContent responses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function assertNotContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (!haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Unexpected token: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}ClinPGx Structured Content Regression Tests${RESET}`);

// Verify all tool files return both content and structuredContent
const toolExpectations = [
  {
    path: 'src/tools/gene-lookup.ts',
    required: ['structuredContent', 'content', 'shouldStage', 'stageToDoAndRespond'],
  },
  {
    path: 'src/tools/drug-lookup.ts',
    required: ['structuredContent', 'content', 'shouldStage', 'stageToDoAndRespond'],
  },
  {
    path: 'src/tools/clinical-annotations.ts',
    required: ['structuredContent', 'content', 'shouldStage', 'stageToDoAndRespond'],
  },
  {
    path: 'src/tools/guideline-annotations.ts',
    required: ['structuredContent', 'content', 'shouldStage', 'stageToDoAndRespond'],
  },
];

for (const { path: filePath, required } of toolExpectations) {
  const content = readFile(filePath);
  for (const token of required) {
    assertContains(filePath, content, token, `${filePath} includes ${token}`);
  }
}

// Verify Code Mode registration
const codeModeContent = readFile('src/tools/code-mode.ts');
assertContains('src/tools/code-mode.ts', codeModeContent, 'clinpgx', 'code-mode.ts uses clinpgx prefix');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createSearchTool', 'code-mode.ts uses createSearchTool');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createExecuteTool', 'code-mode.ts uses createExecuteTool');

// Verify query-data and get-schema
const queryDataContent = readFile('src/tools/query-data.ts');
assertContains('src/tools/query-data.ts', queryDataContent, 'CLINPGX_DATA_DO', 'query-data.ts references CLINPGX_DATA_DO');
assertContains('src/tools/query-data.ts', queryDataContent, 'clinpgx_query_data', 'query-data.ts registers clinpgx_query_data');

const getSchemaContent = readFile('src/tools/get-schema.ts');
assertContains('src/tools/get-schema.ts', getSchemaContent, 'CLINPGX_DATA_DO', 'get-schema.ts references CLINPGX_DATA_DO');
assertContains('src/tools/get-schema.ts', getSchemaContent, 'clinpgx_get_schema', 'get-schema.ts registers clinpgx_get_schema');

// Verify index.ts exports Durable Object and registers tools
const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'ClinpgxDataDO', 'index.ts exports ClinpgxDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');
assertContains('src/index.ts', indexContent, 'registerGeneLookup', 'index.ts registers gene lookup');
assertContains('src/index.ts', indexContent, 'registerDrugLookup', 'index.ts registers drug lookup');
assertContains('src/index.ts', indexContent, 'registerClinicalAnnotations', 'index.ts registers clinical annotations');
assertContains('src/index.ts', indexContent, 'registerGuidelineAnnotations', 'index.ts registers guideline annotations');
assertContains('src/index.ts', indexContent, 'registerCodeMode', 'index.ts registers code mode');

// Verify DO
const doContent = readFile('src/do.ts');
assertContains('src/do.ts', doContent, 'RestStagingDO', 'do.ts extends RestStagingDO');
assertContains('src/do.ts', doContent, 'getSchemaHints', 'do.ts implements getSchemaHints');

// Verify catalog
const catalogContent = readFile('src/spec/catalog.ts');
assertContains('src/spec/catalog.ts', catalogContent, 'ApiCatalog', 'catalog.ts uses ApiCatalog type');
assertContains('src/spec/catalog.ts', catalogContent, 'api.clinpgx.org', 'catalog.ts uses ClinPGx base URL');
assertContains('src/spec/catalog.ts', catalogContent, '/data/gene', 'catalog.ts has gene endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/chemical', 'catalog.ts has chemical endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/clinicalAnnotation', 'catalog.ts has clinical annotation endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/guidelineAnnotation', 'catalog.ts has guideline annotation endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/drugLabel', 'catalog.ts has drug label endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/variantAnnotation', 'catalog.ts has variant annotation endpoints');
assertContains('src/spec/catalog.ts', catalogContent, '/data/variant', 'catalog.ts has variant endpoints');

const clinicalAnnotationsContent = readFile('src/tools/clinical-annotations.ts');
assertContains(
  'src/tools/clinical-annotations.ts',
  clinicalAnnotationsContent,
  'annotations = annotations.filter',
  'clinical-annotations.ts filters evidence level client-side'
);
assertContains(
  'src/tools/clinical-annotations.ts',
  clinicalAnnotationsContent,
  'levelOfEvidence === level',
  'clinical-annotations.ts compares against levelOfEvidence'
);

// Verify HTTP client uses ClinPGx URL
const httpContent = readFile('src/lib/http.ts');
assertContains('src/lib/http.ts', httpContent, 'api.clinpgx.org', 'http.ts uses ClinPGx base URL');
assertContains('src/lib/http.ts', httpContent, 'restFetch', 'http.ts uses restFetch from shared');
assertNotContains('src/lib/http.ts', httpContent, 'api.pharmgkb.org', 'http.ts does NOT use deprecated PharmGKB URL');

console.log(`\n${BLUE}Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}ClinPGx structured content regression tests passed.${RESET}`);
