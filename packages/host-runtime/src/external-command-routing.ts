import type { HarnessSession } from "@codexhost/harness-adapter";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  harnessCommandCatalogSchema,
  type HarnessCommandCatalog,
} from "@codexhost/shared-contracts";

export class ExternalCommandError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function isExternalCommandCandidate(text: string): boolean {
  return /^\/[^\s/]+(?:\s|$)/u.test(text.trimStart());
}

/** Inspection must not hold the Desktop request queue for a native RPC timeout. */
export async function inspectLiveCommandCatalog(
  commands: NonNullable<HarnessSession["commands"]>,
  timeoutMs = 1_000,
): Promise<HarnessCommandCatalog | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      commands.list(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return result?.ok ? harnessCommandCatalogSchema.parse(result.value) : null;
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Shared by ordinary submissions and stop-then-start steering replacements. */
export async function resolveExternalCommand(
  commands: NonNullable<HarnessSession["commands"]>,
  text: string,
): Promise<{ commandId: string; arguments?: JsonObject }> {
  const catalog = await commands.list();
  if (!catalog.ok) throw new ExternalCommandError(-32073, catalog.error.message);
  const commandText = text.trim();
  const matched = catalog.value.commands
    .toSorted((left, right) => right.invocation.length - left.invocation.length)
    .find((command) => {
      if (commandText === command.invocation) return true;
      return command.argumentMode === "text" && commandText.startsWith(`${command.invocation} `);
    });
  if (!matched) {
    throw new ExternalCommandError(
      -32078,
      "External Harness does not expose the requested command",
    );
  }
  const argumentText = commandText.slice(matched.invocation.length).trimStart();
  return {
    commandId: matched.id,
    ...(argumentText.length > 0 ? { arguments: { text: argumentText } } : {}),
  };
}
