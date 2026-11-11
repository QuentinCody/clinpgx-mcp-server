/**
 * ClinPGx Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query, returns matching endpoints with docs.
 * execute: V8 isolate with api.get/api.post + searchSpec/listCategories.
 *
 * Tools: clinpgx_search and clinpgx_execute
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { clinpgxCatalog } from "../spec/catalog";
import { createClinpgxApiFetch } from "../lib/api-adapter";
import { clinpgxResponse } from "../lib/tool-result";

interface CodeModeEnv {
    CLINPGX_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

/**
 * Register clinpgx_search and clinpgx_execute tools.
 */
export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createClinpgxApiFetch();
    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        // SAFETY: shared factories supply the MCP registration arguments; only the name changes.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof clinpgxResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => clinpgxResponse(() => handler(args, extra), env, String(name), extra);
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    }};

    // Register the search tool (in-process, no isolate)
    const searchTool = createSearchTool({
        prefix: "clinpgx",
        catalog: clinpgxCatalog,
    });
    searchTool.register(registrar);

    // Register the execute tool (V8 isolate via DynamicWorkerExecutor)
    const executeTool = createExecuteTool({
        prefix: "clinpgx",
        // Verifiable provenance: clinpgx_execute results carry a _meta.citation.
        source: { id: "clinpgx", name: "ClinPGx / CPIC", url: "https://www.clinpgx.org" },
        catalog: clinpgxCatalog,
        apiFetch,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        doNamespace: env.CLINPGX_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
