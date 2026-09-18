import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForkSessionInput } from "@codexhost/harness-adapter";
import { CursorAdapter } from "../src/adapter.js";
import { CursorTransport, type CursorSessionInfo } from "../src/transport.js";
import { forkCursorSession } from "../src/fork.js";
import { cursorTailCheckpoint } from "../src/fork-support.js";
import type * as NativeHistory from "../src/native-history.js";
import type * as Fork from "../src/fork.js";
import type * as ForkSupport from "../src/fork-support.js";

const native = vi.hoisted(() => ({ turns: [] as Array<{ id: string; text: string }> }));
vi.mock("../src/native-history.js", async (original) => ({
  ...(await original<typeof NativeHistory>()),
  readCursorNativeTurns: () => structuredClone(native.turns),
}));
vi.mock("../src/fork.js", async (original) => ({
  ...(await original<typeof Fork>()),
  forkCursorSession: vi.fn(),
}));
vi.mock("../src/fork-support.js", async (original) => ({
  ...(await original<typeof ForkSupport>()),
  cursorForkAvailable: () => true,
}));

const sourceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const targetId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const adapters: CursorAdapter[] = [];
function sessionInfo(sessionId: string) {
  return {
    sessionId,
    configOptions: [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "model",
        options: [{ value: "model", name: "Model" }],
      },
      {
        id: "mode",
        name: "Mode",
        type: "select",
        currentValue: "agent",
        options: [{ value: "agent", name: "Agent" }],
      },
    ],
  } satisfies CursorSessionInfo;
}
function load(transport: CursorTransport, sessionId = sourceId) {
  transport.sessionId = sessionId;
  transport.replay = native.turns.map((turn) => ({
    sessionId,
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: turn.text },
    },
  }));
  return sessionInfo(sessionId);
}
beforeEach(() => {
  native.turns = [{ id: randomUUID(), text: "hello" }];
  vi.spyOn(CursorTransport.prototype, "open").mockImplementation(async function (
    this: CursorTransport,
    sessionId,
  ) {
    return load(this, sessionId);
  });
  vi.spyOn(CursorTransport.prototype, "close").mockResolvedValue();
  vi.spyOn(CursorTransport.prototype, "configure").mockImplementation(async function (
    this: CursorTransport,
  ) {
    return { configOptions: sessionInfo(this.sessionId).configOptions };
  });
});
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  vi.restoreAllMocks();
  vi.mocked(forkCursorSession).mockReset();
});
async function fixture() {
  const adapter = new CursorAdapter({ environment: {} });
  adapters.push(adapter);
  const opened = await adapter.open({ kind: "create", cwd: process.cwd() });
  if (!opened.ok) throw new Error(opened.error.message);
  const source = opened.value;
  const sourceRef = source.initialState.nativeRef;
  const tail = native.turns.at(-1);
  if (!sourceRef || !tail) throw new Error("Missing fixture identity");
  const input: ForkSessionInput = {
    kind: "fork",
    cwd: process.cwd(),
    sourceRef,
    checkpoint: cursorTailCheckpoint(sourceId, tail.id),
  };
  const transaction = {
    sessionId: targetId,
    expected: structuredClone(native.turns),
    commit: vi.fn(),
    discard: vi.fn(async () => {}),
  };
  vi.mocked(forkCursorSession).mockResolvedValue(transaction);
  return { adapter, source, input, transaction };
}

describe("Cursor Adapter fork adoption", () => {
  it("commits the new session only after ACP load and restores source availability", async () => {
    const f = await fixture();
    const result = await f.adapter.open(f.input);
    expect(result).toMatchObject({
      ok: true,
      value: { initialState: { nativeRef: { nativeSessionId: targetId } } },
    });
    expect(f.transaction.commit).toHaveBeenCalledOnce();
    expect(f.transaction.discard).not.toHaveBeenCalled();
    expect(CursorTransport.prototype.open).toHaveBeenCalledWith(targetId);
    expect(await f.source.readSnapshot()).toMatchObject({ ok: true });
  });

  it("discards the target and releases the source lock when ACP adoption fails", async () => {
    const f = await fixture();
    vi.mocked(CursorTransport.prototype.open).mockRejectedValueOnce(new Error("load failed"));
    expect(await f.adapter.open(f.input)).toMatchObject({
      ok: false,
      error: { message: "load failed" },
    });
    expect(f.transaction.commit).not.toHaveBeenCalled();
    expect(f.transaction.discard).toHaveBeenCalledOnce();
    expect(await f.source.readSnapshot()).toMatchObject({ ok: true });
  });

  it("holds the source lock during staging and releases it after failure", async () => {
    const f = await fixture();
    const staging = Promise.withResolvers<typeof f.transaction>();
    vi.mocked(forkCursorSession).mockReturnValueOnce(staging.promise);
    const pending = f.adapter.open(f.input);
    expect(await f.source.readSnapshot()).toMatchObject({ error: { code: "sessionBusy" } });
    expect(await f.adapter.open(f.input)).toMatchObject({ error: { code: "sessionBusy" } });
    expect(forkCursorSession).toHaveBeenCalledOnce();
    staging.reject(new Error("native fork failed"));
    expect(await pending).toMatchObject({ ok: false });
    expect(await f.source.readSnapshot()).toMatchObject({ ok: true });
    expect(await f.adapter.open(f.input)).toMatchObject({ ok: true });
  });

  it("rejects a busy source before starting native Fork", async () => {
    const f = await fixture();
    const configuring = Promise.withResolvers<{
      configOptions: NonNullable<CursorSessionInfo["configOptions"]>;
    }>();
    vi.mocked(CursorTransport.prototype.configure).mockReturnValueOnce(configuring.promise);
    const permissionModeId = f.source.initialState.effectivePermissionModeId;
    if (!permissionModeId) throw new Error("Missing fixture mode");
    const selection = f.source.execute({
      type: "permissionMode.select",
      permissionModeId,
    });
    expect(await f.adapter.open(f.input)).toMatchObject({ error: { code: "sessionBusy" } });
    expect(forkCursorSession).not.toHaveBeenCalled();
    configuring.resolve({ configOptions: sessionInfo(sourceId).configOptions });
    expect(await selection).toMatchObject({ ok: true });
    expect(await f.adapter.open(f.input)).toMatchObject({ ok: true });
  });

  it("rejects old or missing boundaries before staging and releases the lock", async () => {
    const earlierId = randomUUID();
    native.turns.unshift({ id: earlierId, text: "earlier" });
    const f = await fixture();
    expect(
      await f.adapter.open({
        ...f.input,
        checkpoint: cursorTailCheckpoint(sourceId, earlierId),
      }),
    ).toMatchObject({ error: { code: "unsupported" } });
    expect(
      await f.adapter.open({
        ...f.input,
        checkpoint: cursorTailCheckpoint(sourceId, randomUUID()),
      }),
    ).toMatchObject({ error: { code: "checkpointNotFound" } });
    expect(forkCursorSession).not.toHaveBeenCalled();
    expect(await f.adapter.open(f.input)).toMatchObject({ ok: true });
  });

  it("cancels staging on Adapter close and discards a target returned after cancellation", async () => {
    const f = await fixture();
    const staging = Promise.withResolvers<typeof f.transaction>();
    vi.mocked(forkCursorSession).mockReturnValueOnce(staging.promise);
    const pending = f.adapter.open(f.input);
    const call = vi.mocked(forkCursorSession).mock.calls[0];
    if (!call) throw new Error("Native Fork did not start");
    const signal = call[3];
    const closing = f.adapter.close();
    expect(signal.aborted).toBe(true);
    staging.resolve(f.transaction);
    expect(await pending).toMatchObject({ ok: false });
    await closing;
    expect(f.transaction.discard).toHaveBeenCalledOnce();
    expect(f.transaction.commit).not.toHaveBeenCalled();
    expect(CursorTransport.prototype.open).not.toHaveBeenCalledWith(targetId);
    expect(await f.source.readSnapshot()).toMatchObject({ error: { code: "invalidState" } });
  });

  it("closes the pending ACP target and discards it when Adapter closes during adoption", async () => {
    const f = await fixture();
    const adoption = Promise.withResolvers<CursorSessionInfo>();
    const entered = Promise.withResolvers<undefined>();
    vi.mocked(CursorTransport.prototype.open).mockImplementationOnce(async function (
      this: CursorTransport,
      sessionId,
    ) {
      load(this, sessionId);
      entered.resolve(undefined);
      return adoption.promise;
    });
    const pending = f.adapter.open(f.input);
    await entered.promise;
    const closing = f.adapter.close();
    adoption.resolve(sessionInfo(targetId));
    expect(await pending).toMatchObject({ ok: false });
    await closing;
    expect(f.transaction.discard).toHaveBeenCalledOnce();
    expect(f.transaction.commit).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(CursorTransport.prototype.close)
        .mock.contexts.map((transport) =>
          transport instanceof CursorTransport ? transport.sessionId : undefined,
        ),
    ).toEqual(expect.arrayContaining([sourceId, targetId]));
  });
});
