import type { HarnessPluginContext } from "@codexhost/harness-adapter/plugin";
import { ZcodeAdapter } from "./adapter.js";
export function createHarnessAdapter(context: HarnessPluginContext) {
  return new ZcodeAdapter({
    environment: {
      ...context.environment,
      ...(context.launchCommand ? { CODEXHOST_ZCODE_COMMAND: context.launchCommand } : {}),
    },
  });
}
