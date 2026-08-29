import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerGeneLookup } from "./tools/gene-lookup";
import { registerDrugLookup } from "./tools/drug-lookup";
import { registerClinicalAnnotations } from "./tools/clinical-annotations";
import { registerGuidelineAnnotations } from "./tools/guideline-annotations";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { ClinpgxDataDO } from "./do";

// Export Durable Object classes
export { ClinpgxDataDO };

interface ClinpgxEnv {
    CLINPGX_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends StatelessMcpWorker {
    server = new McpServer({
        name: "clinpgx",
        version: "0.1.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env as unknown as ClinpgxEnv;
        registerGeneLookup(this.server, env);
        registerDrugLookup(this.server, env);
        registerClinicalAnnotations(this.server, env);
        registerGuidelineAnnotations(this.server, env);
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("clinpgx");
        }

        if (url.pathname === "/readyz") {
            // Deep check: builds the MCP server the way a real request does, so a
            // factory that throws is a 503 here instead of a green /health over a
            // server that 500s every MCP call.
            return MyMCP.readiness(env, "clinpgx");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};
