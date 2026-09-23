import {
  harnessCommandCatalogSchema,
  harnessCommandDescriptorSchema,
  type HarnessCommandCatalog,
  type HarnessCommandDescriptor,
} from "@codexhost/shared-contracts";

/** Entry of Pi's RPC `get_commands` response. */
export interface PiNativeCommand {
  name: string;
  description?: string;
  /** `extension`, `prompt` (template) or `skill`. */
  source?: string;
}

const DYNAMIC_ID_PREFIX = "pi.slash.";
// Host-internal RPC helpers registered by extensions, not user commands.
const INTERNAL_COMMANDS = new Set(["subagents-inspect-rpc"]);

export function parsePiNativeCommands(response: unknown): PiNativeCommand[] {
  const data =
    typeof response === "object" && response !== null
      ? (response as { data?: { commands?: unknown } }).data
      : undefined;
  if (!Array.isArray(data?.commands)) return [];
  return data.commands.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().replace(/^\//u, "") : "";
    if (!name) return [];
    return [
      {
        name,
        ...(typeof record.description === "string" ? { description: record.description } : {}),
        ...(typeof record.source === "string" ? { source: record.source } : {}),
      },
    ];
  });
}

/**
 * Built-ins keep their dedicated handling; the live Session's commands,
 * prompt templates and skills are appended. Dynamic entries accept text so the
 * Composer claims them for the user to complete.
 */
export function piLiveCommandCatalog(
  builtIns: HarnessCommandCatalog,
  native: readonly PiNativeCommand[] | null,
): HarnessCommandCatalog {
  if (!native) return builtIns;
  const invocations = new Set(builtIns.commands.map(({ invocation }) => invocation));
  const ids = new Set<string>(builtIns.commands.map(({ id }) => id));
  const dynamic: HarnessCommandDescriptor[] = [];
  for (const command of native) {
    if (INTERNAL_COMMANDS.has(command.name)) continue;
    const invocation = `/${command.name}`;
    const id = `${DYNAMIC_ID_PREFIX}${command.name.replace(/[^A-Za-z0-9._:-]/gu, "-")}`.slice(
      0,
      128,
    );
    if (invocations.has(invocation) || ids.has(id)) continue;
    const description = command.description?.trim().slice(0, 512);
    const parsed = harnessCommandDescriptorSchema.safeParse({
      id,
      invocation,
      label: command.name.slice(0, 128),
      ...(description ? { description } : {}),
      argumentMode: "text",
      kind: command.source === "skill" ? "skill" : "command",
    });
    if (!parsed.success) continue;
    invocations.add(invocation);
    ids.add(id);
    dynamic.push(parsed.data);
  }
  return harnessCommandCatalogSchema.parse({ commands: [...builtIns.commands, ...dynamic] });
}

/** Prompt text for a dynamic command, or null when the id is not dynamic. */
export function piDynamicCommandPrompt(
  catalog: HarnessCommandCatalog,
  commandId: string,
  argumentText: string | undefined,
): string | null {
  if (!commandId.startsWith(DYNAMIC_ID_PREFIX)) return null;
  const descriptor = catalog.commands.find(({ id }) => id === commandId);
  if (!descriptor) return null;
  const text = argumentText?.trim();
  return text ? `${descriptor.invocation} ${text}` : descriptor.invocation;
}
