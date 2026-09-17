import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import type {
  HarnessSessionState,
  OpenSessionInput,
  ResumeSessionInput,
} from "@codexhost/harness-adapter";
import {
  harnessThinkingOptionIdSchema,
  harnessPermissionModeIdSchema,
  nativeSessionRefSchema,
  type NativeSessionRef,
} from "@codexhost/shared-contracts";
import type { CodeBuddyClientFactory } from "./acp-client.js";
import { codeBuddyInvocation } from "./command.js";
import { bounded, CODEBUDDY_ID, CodeBuddyError, record, text } from "./common.js";
import { configuration, modelRef } from "./configuration.js";
import {
  codeBuddyNativeHistory,
  nativeHistoryRows,
  snapshotFromHistory,
  validateNativeRef,
} from "./history.js";

type DeriveInput = Extract<OpenSessionInput, { kind: "fork" | "rollbackLastTurn" }>;
type Row = Record<string, unknown>;

/** Only native administrative operations: EOF requests replay, never an empty model prompt. */
export async function copyCodeBuddySession(
  cwd: string,
  sourceId: string,
  targetId: string,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    throw new CodeBuddyError("invalidState", "Adapter closed before history copy");
  const invocation = codeBuddyInvocation(environment, false, [
    "--resume",
    sourceId,
    "--fork-session",
    "--session-id",
    targetId,
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
  ]);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, {
      cwd,
      env: invocation.environment,
      stdio: "pipe",
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: process.platform !== "win32",
    });
    let output = "",
      bytes = 0,
      failed = false;
    let termination = Promise.resolve();
    const stop = () => {
      if (failed) return;
      failed = true;
      if (child.exitCode !== null || child.signalCode !== null) {
        // Do not signal a potentially reused PID while a descendant owns a pipe.
        child.stdout.destroy();
        child.stderr.destroy();
      } else if (process.platform === "win32" && child.pid) {
        termination = new Promise<void>((resolve) => {
          execFile(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 3_000 },
            () => {
              child.kill();
              resolve();
            },
          );
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 30_000);
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > 64_000_000) {
        stop();
        return;
      }
      output += data.toString();
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("error", reject);
    child.once("close", async (code) => {
      await termination;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (failed || signal.aborted || code !== 0) {
        reject(
          new CodeBuddyError("nativeFailure", "Native history copy failed or was interrupted"),
        );
        return;
      }
      try {
        const rows = output
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => record(JSON.parse(line)));
        const init = rows.find((row) => row.type === "system" && row.subtype === "init");
        const result = rows.findLast((row) => row.type === "result");
        if (
          init?.session_id !== targetId ||
          result?.session_id !== targetId ||
          result?.is_error !== false ||
          result?.duration_api_ms !== 0
        )
          throw new CodeBuddyError(
            "unsupported",
            "Native CLI did not confirm a model-free history copy",
          );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    if (signal.aborted) stop();
    child.stdin.end();
  });
}

function withoutIdentity(row: Row) {
  const result = { ...row };
  delete result.id;
  delete result.parentId;
  delete result.logicalParentId;
  delete result.sessionId;
  return result;
}

/** Native /fork remaps IDs; compare content and both parent edges, not generated IDs. */
export function assertCopiedPrefix(source: Row[], copied: Row[]) {
  if (copied.length < source.length)
    throw new CodeBuddyError("unsupported", "Native Fork omitted history");
  const ids = new Map(source.map((row, index) => [text(row.id), text(copied[index]?.id)]));
  for (const [index, row] of source.entries()) {
    const clone = copied[index];
    if (!clone) throw new CodeBuddyError("unsupported", "Native Fork omitted history");
    if (
      !isDeepStrictEqual(withoutIdentity(row), withoutIdentity(clone)) ||
      ["parentId", "logicalParentId"].some(
        (key) => text(clone[key]) !== (ids.get(text(row[key])) ?? ""),
      )
    )
      throw new CodeBuddyError(
        "unsupported",
        "Native Fork did not preserve the exact history prefix",
      );
  }
}

function commandCaveat(row: Row | undefined) {
  return (
    record(row?.providerData).skipRun === true &&
    JSON.stringify(row?.content).includes('data-role=\\"command-caveat\\"')
  );
}

export function retainedRowCount(input: DeriveInput, contents: string) {
  const rows = nativeHistoryRows(contents);
  const turns = snapshotFromHistory(contents, input.sourceRef, input.cwd).turns;
  let excluded: string | undefined;
  if (input.kind === "rollbackLastTurn") {
    if (!turns.length)
      throw new CodeBuddyError("invalidState", "Native Session has no Turn to revise");
    excluded = turns.at(-1)?.nativeTurnRef.nativeTurnKey;
  } else {
    const checkpoint = input.checkpoint;
    const index = turns.findIndex(
      (turn) => turn.nativeTurnRef.nativeTurnKey === checkpoint.checkpointId,
    );
    if (
      checkpoint.harnessId !== CODEBUDDY_ID ||
      checkpoint.nativeSessionId !== input.sourceRef.nativeSessionId ||
      checkpoint.formatVersion !== 1 ||
      index < 0
    )
      throw new CodeBuddyError("checkpointNotFound", "Native Fork checkpoint was not found");
    excluded = turns[index + 1]?.nativeTurnRef.nativeTurnKey;
  }
  let count = excluded ? rows.findIndex((row) => row.id === excluded) : rows.length;
  if (count < 0) throw new CodeBuddyError("protocolError", "Native Turn boundary is missing");
  if (excluded) while (count > 0 && commandCaveat(rows[count - 1])) count--;
  return count;
}

export interface DerivationOptions {
  input: DeriveInput;
  environment: NodeJS.ProcessEnv;
  factory: CodeBuddyClientFactory;
  signal: AbortSignal;
  state?: HarnessSessionState;
  copy?: typeof copyCodeBuddySession;
}

/** Keep the broken print-copy runtime identity away from model work and subagents. */
export async function deriveCodeBuddySession(
  options: DerivationOptions,
): Promise<ResumeSessionInput> {
  const { input, environment, factory, signal } = options;
  validateNativeRef(input.sourceRef);
  const source = await codeBuddyNativeHistory(input.cwd, input.sourceRef, environment);
  const retained = retainedRowCount(input, source.contents);
  const sourceRows = nativeHistoryRows(source.contents);
  const temporary = nativeSessionRefSchema.parse({
    harnessId: CODEBUDDY_ID,
    nativeSessionId: randomUUID(),
    formatVersion: 1,
  });
  await (options.copy ?? copyCodeBuddySession)(
    input.cwd,
    input.sourceRef.nativeSessionId,
    temporary.nativeSessionId,
    environment,
    signal,
  );
  const copy = await codeBuddyNativeHistory(input.cwd, temporary, environment, source.contents);
  if (!isDeepStrictEqual(nativeHistoryRows(copy.contents), sourceRows))
    throw new CodeBuddyError("unsupported", "Native history copy changed the source prefix");
  let derivedId: string | undefined;
  let failure: unknown;
  let receiveCommands!: (commands: unknown) => void;
  const commands = new Promise<unknown>((resolve) => {
    receiveCommands = resolve;
  });
  const client = factory({
    cwd: input.cwd,
    environment,
    ephemeral: false,
    handlers: {
      permission: async () => ({ outcome: { outcome: "cancelled" } }),
      question: async () => ({ outcome: "cancelled" }),
      fault: (error) => {
        failure = error;
      },
      update: ({ sessionId, update }) => {
        if (record(update).sessionUpdate === "available_commands_update")
          receiveCommands(record(update).availableCommands);
        const meta = record(record(update)._meta);
        if (
          meta["codebuddy.ai/sessionReset"] === true &&
          meta["codebuddy.ai/newSessionId"] === sessionId
        )
          derivedId = sessionId;
      },
    },
  });
  const abort = () => {
    void client.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new CodeBuddyError("invalidState", "Adapter closed during Fork");
    await client.initialize();
    const opened = await client.open(input.cwd, temporary.nativeSessionId);
    const nativeState = configuration(opened.configOptions).state;
    const available = await bounded(commands, 5_000, "Native command discovery", abort);
    if (!Array.isArray(available) || !available.some((entry) => record(entry).name === "fork"))
      throw new CodeBuddyError("unsupported", "Native Session does not advertise /fork");
    const result = await bounded(
      client.prompt(temporary.nativeSessionId, "/fork"),
      20_000,
      "Native Fork",
      abort,
    );
    if (failure) throw failure;
    if (
      result.stopReason !== "end_turn" ||
      !derivedId ||
      [input.sourceRef.nativeSessionId, temporary.nativeSessionId].includes(derivedId)
    )
      throw new CodeBuddyError("unsupported", "Native Fork did not report a separate Session");
    const ref: NativeSessionRef = nativeSessionRefSchema.parse({
      harnessId: CODEBUDDY_ID,
      nativeSessionId: derivedId,
      formatVersion: 1,
      locator: { codebuddyDerived: 1 },
    });
    const forked = await codeBuddyNativeHistory(input.cwd, ref, environment);
    const forkRows = nativeHistoryRows(forked.contents);
    assertCopiedPrefix(sourceRows, forkRows);
    if (!client.rollback)
      throw new CodeBuddyError("unsupported", "Native history rewind is unavailable");
    const point = retained ? text(forkRows[retained - 1]?.id) : null;
    const rewound = await client.rollback(derivedId, point);
    if (rewound.applied !== true || (rewound.actualForkPointId ?? null) !== point)
      throw new CodeBuddyError("nativeFailure", "Native history rewind was not confirmed");
    const verified = await codeBuddyNativeHistory(input.cwd, ref, environment);
    if (!isDeepStrictEqual(nativeHistoryRows(verified.contents), forkRows.slice(0, retained)))
      throw new CodeBuddyError(
        "nativeFailure",
        "Native history rewind did not persist the exact prefix",
      );
    const after = await codeBuddyNativeHistory(input.cwd, input.sourceRef, environment);
    if (after.contents !== source.contents)
      throw new CodeBuddyError("sessionBusy", "Source history changed during Fork");
    if (signal.aborted) throw new CodeBuddyError("invalidState", "Adapter closed during Fork");
    const saved = record(record(input.sourceRef.locator).configuration);
    const state = options.state ?? {
      ...nativeState,
      ...(text(saved.model) ? { effectiveModel: modelRef(text(saved.model)) } : {}),
    };
    const model =
      input.kind === "rollbackLastTurn" && input.model ? input.model : state.effectiveModel;
    const thinking =
      input.kind === "rollbackLastTurn" && input.thinkingOptionId
        ? input.thinkingOptionId
        : (options.state?.effectiveThinkingOptionId ??
          (text(saved.thinking)
            ? harnessThinkingOptionIdSchema.parse(saved.thinking)
            : state.effectiveThinkingOptionId));
    const mode =
      input.kind === "rollbackLastTurn" && input.permissionModeId
        ? input.permissionModeId
        : (options.state?.effectivePermissionModeId ??
          (text(saved.mode)
            ? harnessPermissionModeIdSchema.parse(saved.mode)
            : state.effectivePermissionModeId));
    return {
      kind: "resume",
      nativeRef: ref,
      cwd: input.cwd,
      ...(input.environment ? { environment: input.environment } : {}),
      ...(model ? { model } : {}),
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      ...(mode ? { permissionModeId: mode } : {}),
    };
  } finally {
    signal.removeEventListener("abort", abort);
    await client.close();
    // ACP has no Session deletion method. Never unlink native stores behind its back.
  }
}
