/**
 * ClinPGx Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query, returns matching endpoints with docs.
 * execute: V8 isolate with api.get/api.post + searchSpec/listCategories.
 *
 * Tools: clinpgx_search and clinpgx_execute
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { clinpgxCatalog } from "../spec/catalog";
import { createClinpgxApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    CLINPGX_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

/**
 * Register clinpgx_search and clinpgx_execute tools.
 */
export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createClinpgxApiFetch();

    // Register the search tool (in-process, no isolate)
    const searchTool = createSearchTool({
        prefix: "clinpgx",
        catalog: clinpgxCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    // Register the execute tool (V8 isolate via DynamicWorkerExecutor)
    const executeTool = createExecuteTool({
        prefix: "clinpgx",
        catalog: clinpgxCatalog,
        apiFetch,
        doNamespace: env.CLINPGX_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
