import type { HarnessCommandInvocation, HarnessResult } from "@codexhost/harness-adapter";
import type { HarnessCommandCatalog } from "@codexhost/shared-contracts";
import { CODEBUDDY_RUNTIME_PROFILE, failure, type CodeBuddyRuntimeProfile } from "./common.js";

// These native commands switch Session identity, detach work, or require a native UI.
// They cannot execute through the Host's current-Session command contract.
const excluded = new Set([
  "background",
  "bg",
  "branch",
  "fork",
  "fork-bg",
  "clear",
  "resume",
  "exit",
  "rewind",
  "multitask",
  "agent-mode",
  "btw",
  "loop",
  "goal",
  "login",
  "logout",
  "feedback",
  "keybindings",
  "copy",
  "statusline",
  "gateway",
  "remote-control",
  "_compact",
]);

export function isExcludedInvocation(invocation: string | undefined): boolean {
  return invocation?.startsWith("/") === true && excluded.has(invocation.slice(1));
}

export function commandPrompt(
  command: HarnessCommandInvocation,
  catalog: HarnessCommandCatalog,
  profile: CodeBuddyRuntimeProfile = CODEBUDDY_RUNTIME_PROFILE,
): HarnessResult<string> {
  const descriptor = catalog.commands.find((entry) => entry.id === command.commandId);
  if (!descriptor)
    return failure("unsupported", "Command is not available in this Session", profile);
  const args = command.arguments;
  if (
    args &&
    (Object.keys(args).some((key) => key !== "text") ||
      (args.text !== undefined && typeof args.text !== "string") ||
      (descriptor.argumentMode === "none" && Object.keys(args).length > 0))
  )
    return failure("invalidRequest", "Command arguments must match the native command", profile);
  const argument = typeof args?.text === "string" ? args.text.trim() : "";
  return { ok: true, value: `${descriptor.invocation}${argument ? ` ${argument}` : ""}` };
}
