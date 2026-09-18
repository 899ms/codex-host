import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { record, text, workspaceStateSchema, type NativeSnapshot } from "./protocol.js";
import type { ZcodeTransport } from "./transport.js";
import { ZcodeError } from "./errors.js";

/** The Desktop sends this same ephemeral registry to app-server. Never copy its credentials to disk. */
export async function readWorkspace(
  transport: ZcodeTransport,
  workspace: NativeSnapshot["session"]["workspace"] = {
    workspacePath: transport.options.cwd,
    workspaceKey: transport.options.cwd,
  },
) {
  let state = workspaceStateSchema.parse(
    await transport.request("workspace/readState", { workspace }),
  );
  const explicit = transport.options.environment.CODEXHOST_ZCODE_CONFIG;
  if (!explicit && state.settings.model.available.length) return state;
  const configPath =
    explicit ??
    path.join(
      transport.options.environment.HOME ?? transport.options.environment.USERPROFILE ?? homedir(),
      ".zcode",
      "v2",
      "config.json",
    );
  let config: Record<string, unknown>;
  try {
    config = record(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (!explicit && error instanceof Error && "code" in error && error.code === "ENOENT")
      return state;
    throw new ZcodeError("unavailable", "ZCode provider configuration cannot be read");
  }
  const providers = Object.entries(record(config.provider)).flatMap(([providerId, value]) => {
    const provider = record(value),
      options = record(provider.options);
    if (provider.enabled === false || provider.systemDisabledReason) return [];
    if (!["anthropic", "openai", "openai-compatible"].includes(text(provider.kind))) return [];
    const models = Object.entries(record(provider.models)).flatMap(([modelId, value]) => {
      const model = record(value),
        reasoning = record(model.reasoning),
        limits = record(model.limit);
      if (model.disabled === true) return [];
      const levels = Array.isArray(reasoning.levels)
        ? reasoning.levels.filter((level): level is string => typeof level === "string")
        : [];
      return [
        {
          modelId,
          label: text(model.name) || modelId,
          ...(typeof (limits.context ?? model.contextWindow) === "number"
            ? { contextWindow: limits.context ?? model.contextWindow }
            : {}),
          ...(typeof (limits.output ?? model.maxOutputTokens) === "number"
            ? { maxOutputTokens: limits.output ?? model.maxOutputTokens }
            : {}),
          ...(model.options ? { providerOptions: model.options } : {}),
          ...(levels.length || model.reasoning === false || reasoning.enabled === false
            ? {
                reasoning: {
                  enabled: model.reasoning !== false && reasoning.enabled !== false,
                  ...(reasoning.providerOptionsByLevel
                    ? { providerOptionsByLevel: reasoning.providerOptionsByLevel }
                    : {}),
                  levels: levels.map((value) => ({ value, label: value })),
                  ...(typeof reasoning.defaultLevel === "string"
                    ? { defaultLevel: reasoning.defaultLevel }
                    : {}),
                },
              }
            : {}),
        },
      ];
    });
    if (!models.length) return [];
    return [
      {
        providerId,
        kind: provider.kind,
        label: text(provider.name) || providerId,
        source: "ephemeral",
        ...(text(options.baseURL) ? { baseURL: options.baseURL } : {}),
        ...(text(options.apiKey) ? { apiKey: { source: "inline", value: options.apiKey } } : {}),
        ...(typeof options.apiKeyRequired === "boolean"
          ? { apiKeyRequired: options.apiKeyRequired }
          : {}),
        ...(options.headers ? { headers: options.headers } : {}),
        models,
      },
    ];
  });
  if (!providers.length) return state;
  const result = record(
    await transport.request("workspace/updateProviderRegistry", {
      workspace,
      registry: {
        revision: createHash("sha256").update(JSON.stringify(providers)).digest("hex"),
        generatedAt: Date.now(),
        providers,
      },
    }),
  );
  if (result.status === "failed")
    throw new ZcodeError("unavailable", "ZCode rejected the Desktop provider registry");
  state = workspaceStateSchema.parse(result.workspaceState);
  return state;
}
