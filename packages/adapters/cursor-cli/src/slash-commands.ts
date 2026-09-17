import type { AvailableCommand } from "@agentclientprotocol/sdk";
import {
  harnessCommandDescriptorSchema,
  type HarnessCommandCatalog,
} from "@codexhost/shared-contracts";
import type { HarnessCommandInvocation, HarnessResult } from "@codexhost/harness-adapter";

export function cursorCommands(native: AvailableCommand[]): HarnessCommandCatalog {
  const commands = new Map<string, HarnessCommandCatalog["commands"][number]>();
  for (const command of native) {
    const result = harnessCommandDescriptorSchema.safeParse({
      id: `cursor.${command.name}`,
      invocation: `/${command.name}`,
      label: `/${command.name}`,
      ...(command.description.trim() ? { description: command.description.slice(0, 512) } : {}),
      // Cursor 2026.09.10 omits input metadata for both its administrative command
      // and custom commands/skills, whose parser still accepts trailing text.
      // Honor an explicit native no-input declaration without disabling those skills.
      argumentMode: command.input === null || command.name === "copy-request-id" ? "none" : "text",
    });
    if (result.success) commands.set(result.data.id, result.data);
  }
  return { commands: [...commands.values()] };
}

export function cursorCommandPrompt(
  command: HarnessCommandInvocation,
  catalog: HarnessCommandCatalog,
): HarnessResult<string> {
  const descriptor = catalog.commands.find(({ id }) => id === command.commandId);
  if (!descriptor)
    return {
      ok: false,
      error: {
        code: "unsupported",
        message: "Cursor did not advertise this command",
        retryable: false,
      },
    };
  const args = command.arguments;
  if (
    args &&
    (Object.keys(args).some((key) => key !== "text") ||
      (args.text !== undefined && typeof args.text !== "string") ||
      (descriptor.argumentMode === "none" && Object.keys(args).length))
  )
    return {
      ok: false,
      error: {
        code: "invalidRequest",
        message: "Invalid Cursor command arguments",
        retryable: false,
      },
    };
  const text = typeof args?.text === "string" ? args.text.trim() : "";
  return { ok: true, value: `${descriptor.invocation}${text ? ` ${text}` : ""}` };
}
