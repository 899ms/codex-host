import type { AvailableCommand } from "@agentclientprotocol/sdk";
import {
  harnessCommandCatalogSchema,
  type HarnessCommandCatalog,
} from "@codexhost/shared-contracts";
import type { HarnessCommandInvocation, HarnessResult } from "@codexhost/harness-adapter";

// Model changes use session/set_model so the Host sees confirmed configuration.
// reset would invalidate Host history; queue/steer need overlapping prompt streams.
const SUPPORTED_COMMANDS = new Set(["help", "tools", "context", "compress", "version"]);

export function hermesCommandCatalog(commands: readonly AvailableCommand[]): HarnessCommandCatalog {
  return harnessCommandCatalogSchema.parse({
    commands: commands
      .filter((command) => SUPPORTED_COMMANDS.has(command.name))
      .map((command) => ({
        id: `hermes.${command.name}`,
        invocation: `/${command.name}`,
        label: `/${command.name}`,
        description: command.description.slice(0, 512) || `Hermes /${command.name}`,
        argumentMode: command.input ? "text" : "none",
      })),
  });
}

export function hermesCommandText(
  command: HarnessCommandInvocation,
  catalog: HarnessCommandCatalog,
): HarnessResult<string> {
  const descriptor = catalog.commands.find((entry) => entry.id === command.commandId);
  if (!descriptor)
    return {
      ok: false,
      error: {
        code: "unsupported",
        message: "Hermes did not advertise this command",
        retryable: false,
      },
    };
  const args = command.arguments ?? {};
  if (
    Object.keys(args).some((key) => key !== "text") ||
    (args.text !== undefined && typeof args.text !== "string") ||
    (descriptor.argumentMode === "none" && typeof args.text === "string" && args.text.trim())
  ) {
    return {
      ok: false,
      error: {
        code: "invalidRequest",
        message: "Invalid Hermes command arguments",
        retryable: false,
      },
    };
  }
  return {
    ok: true,
    value: `${descriptor.invocation}${typeof args.text === "string" && args.text.trim() ? ` ${args.text.trim()}` : ""}`,
  };
}
