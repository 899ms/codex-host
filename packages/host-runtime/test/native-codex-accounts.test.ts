import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AccountReadFailure } from "../src/account/native-account-diagnostics.js";
import path from "node:path";
import { NativeCodexAccounts } from "../src/account/native-codex-accounts.js";
import type { StartDeviceCodeLogin } from "../src/account/native-device-code-login.js";
import { credential, createAccountState } from "./fixtures/codex-account-fixtures.js";
const states: Awaited<ReturnType<typeof createAccountState>>[] = [];
afterEach(async () => {
  await Promise.all(states.splice(0).map((s) => s.close()));
});
async function setup(startDeviceCodeLogin?: StartDeviceCodeLogin, current = true) {
  const state = await createAccountState();
  states.push(state);
  if (current) {
    await state.store.install(credential("a"));
    await state.store.captureCurrent();
  }
  const a = state.store.currentAccountId,
    b = await state.store.save(credential("b"));
  const accounts = new NativeCodexAccounts({
    ...state,
    ...(startDeviceCodeLogin ? { startDeviceCodeLogin } : {}),
  });
  await accounts.initialize();
  state.runtime.events.length = 0;
  return { ...state, accounts, a, b };
}
describe("credential replacement", () => {
  it("refresh captures current credentials without holding a request lease", async () => {
    const { accounts, store, runtime } = await setup();
    const capture = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const captureCurrent = store.captureCurrent.bind(store);
    vi.spyOn(store, "captureCurrent").mockImplementationOnce(async () => {
      started.resolve(undefined);
      await capture.promise;
      return captureCurrent();
    });

    const refreshing = accounts.refresh();
    await started.promise;
    try {
      expect(runtime.gate.busy).toBe(false);
      const change = runtime.gate.beginStoppingChange();
      try {
        expect(() => change.assertIdle()).not.toThrow();
      } finally {
        change.finish("ready");
      }
    } finally {
      capture.resolve(undefined);
      await refreshing;
    }
    expect(runtime.gate.busy).toBe(false);
  });
  it("stops, drains external writers, captures final bytes, installs and verifies while admissions are closed", async () => {
    const { store, runtime, accounts, b } = await setup();
    vi.spyOn(store, "captureCurrent").mockImplementation(async () => {
      runtime.events.push("capture");
      return store.readCredentials();
    });
    const install = store.install.bind(store);
    vi.spyOn(store, "install").mockImplementation(async (target) => {
      runtime.events.push("write");
      await install(target);
    });
    runtime.onStop = async () => {
      expect(() => runtime.gate.admit()).toThrow("changing");
    };
    await accounts.switch(b);
    expect(runtime.events).toEqual([
      "capture",
      "check",
      "stop",
      "external",
      "capture",
      "write",
      "start",
      "verify",
      "capture",
    ]);
    expect(accounts.snapshot()).toMatchObject({ currentAccountId: b, phase: "ready" });
  });
  it("records switch and rollback verification failures without secret details", async () => {
    const { accounts, runtime, store, b } = await setup();
    runtime.onVerify = async () => {
      throw new AccountReadFailure(-42, "verify-account-null");
    };
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "authentication-failed" });
    const lines = (await readFile(path.join(store.directory, "diagnostics.log"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        operation: "switch",
        step: "verify-account-null",
        code: -42,
        elapsedMs: expect.any(Number),
      },
      {
        operation: "switch",
        step: "rollback-verify-account-null",
        code: -42,
        elapsedMs: expect.any(Number),
      },
    ]);
    expect(accounts.snapshot().phase).toBe("unavailable");
  });
  it.each(["logout", "recover"] as const)("records %s verification failures", async (operation) => {
    const { accounts, runtime, store } = await setup();
    runtime.onVerify = async () => {
      throw new AccountReadFailure(undefined, "verify-identity-mismatch");
    };
    if (operation === "recover") runtime.gate.unavailable();
    await expect(accounts[operation]()).rejects.toThrow();
    const lines = await readFile(path.join(store.directory, "diagnostics.log"), "utf8");
    expect(JSON.parse(lines.split("\n")[0] ?? "null")).toMatchObject({
      operation,
      step: "verify-identity-mismatch",
    });
  });
  it("same identity does not stop", async () => {
    const { accounts, a, runtime } = await setup();
    await accounts.switch(a ?? "missing");
    expect(runtime.events).toEqual([]);
  });
  it("verification failure restores A and ready", async () => {
    const { accounts, runtime, store, b, a } = await setup();
    runtime.onVerify = async (identity) => {
      if (identity?.subject === "b") throw new Error("bad");
    };
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "switch-failed" });
    expect(accounts.snapshot()).toMatchObject({ phase: "ready", currentAccountId: a });
    expect((await store.readCredentials())?.serializeForNativeStore()).toBe(
      credential("a").serializeForNativeStore(),
    );
  });
  it("preserves final rotated source bytes and refreshed target grants on rollback", async () => {
    const { accounts, runtime, store, b, a } = await setup();
    runtime.onExternalStop = async () => {
      await store.install(credential("a", 2));
    };
    runtime.onVerify = async (identity) => {
      if (identity?.subject === "b") {
        await store.install(credential("b", 2));
        throw new Error("verification failed");
      }
    };
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "switch-failed" });
    expect((await store.readCredentials())?.serializeForNativeStore()).toBe(
      credential("a", 2).serializeForNativeStore(),
    );
    expect(store.vault.accounts.find((account) => account.accountId === b)?.auth).toBe(
      credential("b", 2).serializeForNativeStore(),
    );
    expect(accounts.snapshot()).toMatchObject({ currentAccountId: a, phase: "ready" });
  });
  it("failed stop does not touch auth and ends unavailable", async () => {
    const { accounts, runtime, store, b } = await setup();
    runtime.onStop = async () => {
      throw new Error();
    };
    const install = vi.spyOn(store, "install");
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "switch-failed" });
    expect(install).not.toHaveBeenCalled();
    expect(accounts.snapshot().phase).toBe("unavailable");
  });
  it("external stop failure preserves credentials rotated during stop and ends ready", async () => {
    const { accounts, runtime, store, b, a } = await setup();
    const rotated = credential("a", 2).serializeForNativeStore();
    runtime.onStop = async () => {
      await writeFile(path.join(store.home, "auth.json"), rotated);
    };
    runtime.onExternalStop = async () => {
      throw new Error();
    };
    const install = vi.spyOn(store, "install");
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "switch-failed" });
    expect((await store.readCredentials())?.serializeForNativeStore()).toBe(rotated);
    expect(install).not.toHaveBeenCalled();
    expect(accounts.snapshot()).toMatchObject({ phase: "ready", currentAccountId: a });
  });
  it.each([false, true])(
    "busy credential lease preserves rotated bytes (drains during restart=%s)",
    async (drains) => {
      const { accounts, runtime, store, b, a } = await setup();
      const rotated = credential("a", 2).serializeForNativeStore();
      runtime.onStop = async () => {
        await writeFile(path.join(store.home, "auth.json"), rotated);
      };
      const release = runtime.gate.admit("credential-write");
      if (drains)
        runtime.onVerify = async () => {
          release();
        };
      const install = vi.spyOn(store, "install");
      try {
        await expect(accounts.switch(b)).rejects.toMatchObject({ code: "busy" });
        expect((await store.readCredentials())?.serializeForNativeStore()).toBe(rotated);
        expect(install).not.toHaveBeenCalled();
        expect(accounts.snapshot()).toMatchObject({
          phase: drains ? "ready" : "unavailable",
          currentAccountId: a,
        });
      } finally {
        release();
      }
    },
  );
  it("rejects concurrent switch and native authentication", async () => {
    const { accounts, runtime, b } = await setup();
    const stopped = Promise.withResolvers<undefined>();
    runtime.onStop = () => stopped.promise;
    const first = accounts.switch(b);
    await vi.waitFor(() => expect(runtime.events).toContain("stop"));
    await expect(accounts.switch(b)).rejects.toMatchObject({ code: "changing" });
    stopped.resolve(undefined);
    await first;
    const release = runtime.gate.admit("native-auth");
    await expect(accounts.logout()).rejects.toMatchObject({ code: "busy" });
    release();
  });
  it("logout removes auth without stopping external processes; deletion is inactive-only", async () => {
    const { accounts, runtime, store, a, b } = await setup();
    await expect(accounts.remove(a ?? "missing")).rejects.toMatchObject({
      code: "credential-conflict",
    });
    await accounts.remove(b);
    expect(runtime.events).toEqual([]);
    await accounts.logout();
    expect(await store.readCredentials()).toBeNull();
    expect(runtime.events).not.toContain("external");
  });
  it("recovers even after management initialization failed", async () => {
    const { accounts, runtime } = await setup();
    vi.spyOn(runtime, "checkCredentialStorage").mockRejectedValueOnce(new Error("unsupported"));
    await expect(accounts.initialize()).rejects.toThrow("unsupported");
    expect(accounts.snapshot().capabilities.manage).toBe(false);
    runtime.gate.unavailable();
    await accounts.recover();
    expect(accounts.snapshot()).toMatchObject({ phase: "ready", capabilities: { manage: true } });
  });
});
function login(subject: string, generation = 1) {
  const completed = Promise.withResolvers<boolean>(),
    starting = Promise.withResolvers<undefined>();
  const close = vi.fn(async () => {});
  const start: StartDeviceCodeLogin = async (home) => {
    await starting.promise;
    await mkdir(home, { recursive: true });
    await writeFile(
      path.join(home, "auth.json"),
      credential(subject, generation).serializeForNativeStore(),
    );
    return {
      verificationUrl: "https://auth.openai.com/device",
      userCode: "CODE",
      completed: completed.promise,
      close,
    };
  };
  return { start, starting, completed, close };
}
describe("isolated Settings login", () => {
  it("adds B while A stays current without stopping the backend", async () => {
    const session = login("b");
    const { accounts, runtime, a } = await setup(session.start);
    const events: unknown[] = [];
    accounts.subscribeLogin((event) => events.push(event));
    session.starting.resolve(undefined);
    await accounts.startLogin();
    session.completed.resolve(true);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ success: true, saved: true });
    expect(accounts.currentAccountId()).toBe(a);
    expect(runtime.events).toEqual([]);
    expect(session.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "activates first/current login (current=%s), including early completion",
    async (current) => {
      const session = login("a", 2);
      const { accounts, runtime, store } = await setup(session.start, current);
      const events: unknown[] = [];
      accounts.subscribeLogin((event) => events.push(event));
      session.completed.resolve(true);
      session.starting.resolve(undefined);
      await accounts.startLogin();
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({ success: true, saved: true });
      expect(runtime.events).toContain("external");
      expect((await store.readCredentials())?.serializeForNativeStore()).toBe(
        credential("a", 2).serializeForNativeStore(),
      );
    },
  );
  it("keeps a saved first-login grant when activation fails and restores an absent auth file", async () => {
    const session = login("a");
    const { accounts, runtime, store } = await setup(session.start, false);
    runtime.onVerify = async (identity) => {
      if (identity) throw new Error("activation failed");
    };
    const received = vi.fn();
    accounts.subscribeLogin(received);
    session.starting.resolve(undefined);
    await accounts.startLogin();
    session.completed.resolve(true);
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        saved: true,
        error: "Codex Account saved, but it could not be activated",
      }),
    );
    expect(await store.readCredentials()).toBeNull();
    expect(accounts.snapshot().phase).toBe("ready");
    expect(
      store.vault.accounts.some(
        (account) => account.identity.subject === "a" && account.auth !== null,
      ),
    ).toBe(true);
  });
  it("honors cancellation before start resolves", async () => {
    const session = login("b");
    const { accounts, runtime } = await setup(session.start);
    const starting = accounts.startLogin();
    const rejected = expect(starting).rejects.toMatchObject({ code: "authentication-failed" });
    await vi.waitFor(() => expect(accounts.snapshot().pendingOperation?.kind).toBe("login"));
    const cancelling = accounts.cancelLogin(
      accounts.snapshot().pendingOperation?.operationId ?? "missing",
    );
    session.starting.resolve(undefined);
    await rejected;
    expect(await cancelling).toBe(true);
    expect(session.close).toHaveBeenCalledOnce();
    expect(runtime.events).toEqual([]);
  });
  it("cancels a started session and isolates completion listeners", async () => {
    const session = login("b");
    const { accounts } = await setup(session.start);
    accounts.subscribeLogin(() => {
      throw new Error();
    });
    const received = vi.fn();
    accounts.subscribeLogin(received);
    session.starting.resolve(undefined);
    const started = await accounts.startLogin();
    expect(await accounts.cancelLogin(started.loginId)).toBe(true);
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, saved: false }),
    );
  });
});
