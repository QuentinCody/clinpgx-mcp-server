import type { McpServer } from "@bio-mcp/shared/mcp";
import { registerGeneLookup } from "./gene-lookup";
import { registerDrugLookup } from "./drug-lookup";
import { registerClinicalAnnotations } from "./clinical-annotations";
import { registerGuidelineAnnotations } from "./guideline-annotations";
import { clinpgxResponse, type ClinpgxDataEnv } from "../lib/tool-result";

/** Apply the fleet's two public names to the legacy annotation tools. */
export function registerLegacyTools(server: McpServer, env: Parameters<typeof registerGeneLookup>[1]): void {
  const registrar = new Proxy(server, {
    get(target, property) {
      if (property !== "registerTool") return Reflect.get(target, property, target);
      return (...args: unknown[]) => {
        const [name, ...rest] = args;
        // SAFETY: existing tool factories supply the SDK arguments; only the alias differs.
        const register = target.registerTool.bind(target) as (...values: unknown[]) => unknown;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof clinpgxResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => clinpgxResponse(() => handler(args, extra),
          (env ?? (extra as {env?: ClinpgxDataEnv})?.env ?? {}) as ClinpgxDataEnv, String(name), extra);
        register(`mcp_${String(name)}`, ...rest, respond);
        return register(name, ...rest, respond);
      };
    },
  });
  registerGeneLookup(registrar, env);
  registerDrugLookup(registrar, env);
  registerClinicalAnnotations(registrar, env);
  registerGuidelineAnnotations(registrar, env);
}
