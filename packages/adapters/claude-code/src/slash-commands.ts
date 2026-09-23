import {
  harnessCommandCatalogSchema,
  harnessCommandDescriptorSchema,
  type HarnessCommandCatalog,
  type HarnessCommandDescriptor,
} from "@codexhost/shared-contracts";

/** Slash command as reported by the Claude Agent SDK (`supportedCommands`). */
export interface ClaudeSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

/** Live command state of a started Claude transport. */
export interface ClaudeSlashCommandSnapshot {
  commands: readonly ClaudeSlashCommand[];
  /** Names Claude reports as skills in its `init` system message. */
  skillNames: ReadonlySet<string>;
}

const DYNAMIC_ID_PREFIX = "claude.slash.";

function dynamicCommandId(name: string): string {
  return `${DYNAMIC_ID_PREFIX}${name.replace(/[^A-Za-z0-9._:-]/gu, "-")}`.slice(0, 128);
}

export function parseClaudeSlashCommands(value: unknown): ClaudeSlashCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().replace(/^\//u, "") : "";
    if (!name) return [];
    return [
      {
        name,
        description: typeof record.description === "string" ? record.description : "",
        argumentHint: typeof record.argumentHint === "string" ? record.argumentHint : "",
      },
    ];
  });
}

/**
 * Built-in commands keep their dedicated handling; every other command the
 * live Session reports is appended. Dynamic entries always accept text so the
 * Composer claims them for the user to complete instead of running blindly.
 */
export function claudeLiveCommandCatalog(
  builtIns: HarnessCommandCatalog,
  snapshot: ClaudeSlashCommandSnapshot | null,
): HarnessCommandCatalog {
  if (!snapshot) return builtIns;
  const invocations = new Set(builtIns.commands.map(({ invocation }) => invocation));
  const ids = new Set<string>(builtIns.commands.map(({ id }) => id));
  const dynamic: HarnessCommandDescriptor[] = [];
  for (const command of snapshot.commands) {
    const invocation = `/${command.name}`;
    const id = dynamicCommandId(command.name);
    if (invocations.has(invocation) || ids.has(id)) continue;
    const description = command.description.trim().slice(0, 512);
    const parsed = harnessCommandDescriptorSchema.safeParse({
      id,
      invocation,
      label: command.name.slice(0, 128),
      ...(description ? { description } : {}),
      argumentMode: "text",
      kind: snapshot.skillNames.has(command.name) ? "skill" : "command",
    });
    if (!parsed.success) continue;
    invocations.add(invocation);
    ids.add(id);
    dynamic.push(parsed.data);
  }
  return harnessCommandCatalogSchema.parse({ commands: [...builtIns.commands, ...dynamic] });
}

/** Prompt text for a dynamic command, or null when the id is not dynamic. */
export function claudeDynamicCommandPrompt(
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
