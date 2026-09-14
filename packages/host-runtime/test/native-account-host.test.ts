import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type * as FileSystem from "node:fs/promises";
import type * as NativeFiles from "../src/native-private-files.js";
import type * as NativeLayout from "../src/account/native-account-layout.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficialRuntimeOwner } from "../src/codex-runtime/official-runtime-owner.js";
import type { JsonObject } from "@codexhost/protocol-core";
import { SyntheticPrivateFiles, credential } from "./fixtures/native-account-state.js";
import { nativeDigest } from "../src/account/native-profile-vault.js";

const fixtureState = vi.hoisted(() => ({
  files: undefined as SyntheticPrivateFiles | undefined,
  events: [] as string[],
  externalStop: undefined as (() => Promise<void>) | undefined,
  failCapability: false,
  unreadableJournal: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof FileSystem>();
  return {
    ...fs,
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      if (fixtureState.unreadableJournal && String(args[0]).endsWith("transaction.json"))
        throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      return fs.lstat(...args);
    },
  };
});
function privateFiles(): SyntheticPrivateFiles {
  if (!fixtureState.files) throw new Error("Missing fixture files");
  return fixtureState.files;
}
vi.mock("../src/native-private-files.js", async (original) => ({
  ...(await original<typeof NativeFiles>()),
  NativePrivateFiles: class {
    withReadOnlyDirectoryAccess() {
      return this;
    }
    ensureDirectory(directory: string) {
      return privateFiles().ensureDirectory(directory);
    }
    read(directory: string, name: string) {
      return privateFiles().read(directory, name);
    }
    replace(directory: string, name: string, content: Uint8Array, expected: string | null) {
      return privateFiles().replace(directory, name, content, expected);
    }
    remove(directory: string, name: string, expected: string) {
      return privateFiles().remove(directory, name, expected);
    }
    lock(directory: string, name: string) {
      return privateFiles().lock(directory, name);
    }
  },
}));
vi.mock("../src/native-secret-keys.js", () => ({
  NativeSecretKeys: class {
    async read() {
      return null;
    }
  },
}));
vi.mock("../src/native-process-identity.js", () => ({
  readNativeProcessIdentity: async (_launcher: string, pid: number) =>
    pid === 41 ? "current" : null,
}));
vi.mock("../src/native-process-stop.js", () => ({ stopNativeProcesses: vi.fn(async () => {}) }));
vi.mock("../src/account/native-account-layout.js", async (original) => ({
  ...(await original<typeof NativeLayout>()),
  inspectNativeAccountLayout: vi.fn(async () => {
    throw new Error("Legacy layout must not gate startup");
  }),
}));
vi.mock("../src/codex-runtime/official-cli-version.js", () => ({
  readOfficialCliVersion: vi.fn(async () => {
    throw new Error("Version is not a startup prerequisite");
  }),
}));
vi.mock("../src/codex-runtime/owned-official-backends.js", () => ({
  createOwnedLoopbackBackend: () => {
    const closed = Promise.withResolvers<{ code: number; signal: null }>();
    return {
      processId: 41,
      closed: closed.promise,
      async start() {
        fixtureState.events.push("start");
      },
      async connect() {
        throw new Error("No fixture protocol client");
      },
      async stop() {
        fixtureState.events.push("stop");
        closed.resolve({ code: 0, signal: null });
      },
    };
  },
}));
vi.mock("../src/account/official-account-runtime.js", () => ({
  OfficialAccountRuntime: class {
    constructor(
      private readonly input: {
        owner: OfficialRuntimeOwner;
        reconcilePreviousWriter(): Promise<void>;
        stopExternalProcesses(): Promise<void>;
      },
    ) {
      fixtureState.externalStop = input.stopExternalProcesses;
    }
    get gate() {
      return this.input.owner.gate;
    }
    async checkCredentialStorage() {
      if (fixtureState.failCapability) throw new Error("Unsupported account capabilities");
    }
    async preflight() {
      fixtureState.events.push("preflight");
      if (fixtureState.failCapability) throw new Error("Unsupported account capabilities");
    }
    async stop() {
      await this.input.owner.stop();
    }
    async reconcilePreviousWriter() {
      await this.input.reconcilePreviousWriter();
    }
    async start(home?: string) {
      await this.input.owner.start(
        home ? { homeOverride: home, mode: "management-only" } : { mode: "task" },
      );
    }
    async verify() {
      fixtureState.events.push("verify");
    }
    async stopExternalProcesses() {
      await this.input.stopExternalProcesses();
    }
    subscribe() {
      return () => {};
    }
    async controlRequest(): Promise<JsonObject> {
      return {};
    }
  },
}));

import { prepareLocalCodex } from "../src/native-account-host.js";
import { stopNativeProcesses } from "../src/native-process-stop.js";
import { inspectNativeAccountLayout } from "../src/account/native-account-layout.js";
import { readOfficialCliVersion } from "../src/codex-runtime/official-cli-version.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  vi.clearAllMocks();
  fixtureState.events = [];
  fixtureState.externalStop = undefined;
  fixtureState.failCapability = false;
  fixtureState.unreadableJournal = false;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "codexhost-startup-test-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const directory = path.join(home, ".codexhost-native-accounts");
  await mkdir(home);
  const files = new SyntheticPrivateFiles();
  const remove = files.remove.bind(files);
  vi.spyOn(files, "remove").mockImplementation(async (directory, name, expected) => {
    await remove(directory, name, expected);
    // The lightweight startup check uses real directory entries, while credential
    // contents use the fixture store. Mirror recovery-record deletion in both.
    if (directory.startsWith(`${root}${path.sep}`))
      await rm(path.join(directory, name), { force: true });
  });
  fixtureState.files = files;
  const environment = {
    CODEX_HOME: home,
    CODEXHOST_DATA_DIR: path.join(root, "legacy"),
    CODEXHOST_LAUNCHER_EXECUTABLE: path.join(root, "launcher"),
  };
  return {
    home,
    directory,
    files,
    environment,
    async seed(name: string, value: unknown) {
      await mkdir(directory, { recursive: true });
      const content = JSON.stringify(value);
      await writeFile(path.join(directory, name), content);
      files.seed(directory, name, content);
    },
    async pending(name: string) {
      const homeId = nativeDigest(process.platform === "win32" ? home.toLowerCase() : home);
      const operationId = randomUUID();
      const before = {
        version: 2,
        homeId,
        revision: 0,
        currentAccountId: null,
        lastOperationId: null,
        accounts: [],
      };
      await this.seed("vault.json", {
        version: 2,
        homeId,
        revision: 0,
        lastOperationId: null,
        accounts: [],
      });
      await this.seed(
        name,
        name === "login.json"
          ? { version: 1, operationId, sourceAccountId: null, expiresAt: Date.now() + 60_000 }
          : {
              version: 2,
              operationId,
              phase: "prepared",
              before,
              after: { ...before, revision: 1, lastOperationId: operationId },
              source: null,
              target: null,
            },
      );
    },
    async prepare() {
      const prepared = await prepareLocalCodex({
        stockCodexPath: path.join(root, "codex"),
        arguments: ["app-server"],
        environment,
        sharedListener: false,
        diagnosticOutput: new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      });
      cleanups.push(() => prepared.close());
      return prepared;
    },
  };
}

describe("ordinary native startup versus mutation recovery", () => {
  it("starts exactly once before collection opens, without probes, quota, legacy layout or version checks", async () => {
    const f = await fixture();
    const lock = vi.spyOn(f.files, "lock");
    const pendingOpen = Promise.withResolvers<undefined>();
    const original = f.files.ensureDirectory.bind(f.files);
    vi.spyOn(f.files, "ensureDirectory").mockImplementation(async (directory) => {
      if (directory === f.directory) await pendingOpen.promise;
      await original(directory);
    });
    const prepared = await f.prepare();
    try {
      expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
      expect(prepared.officialRuntimeScope.owner.running).toBe(true);
      expect(lock).not.toHaveBeenCalled();
      expect(inspectNativeAccountLayout).not.toHaveBeenCalled();
      expect(fixtureState.events).toEqual(["start"]);
      await prepared.officialRuntimeScope.start();
      expect(fixtureState.events).toEqual(["start"]);
    } finally {
      pendingOpen.resolve(undefined);
    }
    await prepared.accountControl.refresh?.();
    expect(prepared.accountControl.snapshot().capabilities.manage).toBe(true);
    expect(fixtureState.events).toEqual(["start"]);
    expect(readOfficialCliVersion).not.toHaveBeenCalled();
    expect(stopNativeProcesses).not.toHaveBeenCalled();
  });

  it.each(["pending-appeared", "native-failed"])(
    "does not hide %s during background collection",
    async (failure) => {
      const f = await fixture();
      const opened = Promise.withResolvers<undefined>();
      const ensure = f.files.ensureDirectory.bind(f.files);
      vi.spyOn(f.files, "ensureDirectory").mockImplementation(async (directory) => {
        if (directory === f.directory) await opened.promise;
        await ensure(directory);
      });
      const prepared = await f.prepare();
      try {
        if (failure === "pending-appeared")
          await f.seed("transaction.json", "interrupted mutation");
        else {
          await prepared.officialRuntimeScope.owner.stop();
          prepared.officialRuntimeScope.gate.unavailable();
        }
      } finally {
        opened.resolve(undefined);
      }
      await prepared.accountControl.refresh?.();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("unavailable");
      expect(prepared.officialRuntimeScope.owner.running).toBe(false);
      expect(fixtureState.events).toEqual(["start", "stop"]);
      if (failure === "pending-appeared")
        expect(f.files.peek(f.directory, "transaction.json")).not.toBeNull();
    },
  );

  it("allows old directories, broken backups and unknown account capabilities without restarting", async () => {
    const f = await fixture();
    fixtureState.failCapability = true;
    await f.seed("vault.json", "invalid collection");
    const prepared = await f.prepare();
    await prepared.accountControl.refresh?.();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
    expect(prepared.accountControl.snapshot().capabilities.manage).toBe(false);
    expect(fixtureState.events).toEqual(["start"]);
  });

  it("does not stop native Codex when credential collection itself fails", async () => {
    const f = await fixture();
    f.files.seed(f.home, "auth.json", "not a credential");
    const prepared = await f.prepare();
    await expect(prepared.accountControl.refresh?.()).rejects.toThrow();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
    expect(fixtureState.events).toEqual(["start"]);
  });

  it("treats an unreadable pending-record check as unknown, never clean", async () => {
    const f = await fixture();
    fixtureState.unreadableJournal = true;
    const prepared = await f.prepare();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("unavailable");
    expect(fixtureState.events).toEqual([]);
  });

  it("keeps native use when a collection path is a file rather than a directory", async () => {
    const f = await fixture();
    await writeFile(f.directory, "broken collection directory");
    const prepared = await f.prepare();
    await prepared.accountControl.refresh?.();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
    expect(prepared.accountControl.snapshot().capabilities.manage).toBe(false);
  });

  it("disables collection, not the official backend, when its idle writer lease is lost", async () => {
    const f = await fixture();
    const lock = vi.spyOn(f.files, "lock");
    const prepared = await f.prepare();
    await prepared.accountControl.refresh?.();
    const lease = await lock.mock.results[0]?.value;
    expect(lease).toBeDefined();
    await lease?.release();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
    expect(prepared.accountControl.snapshot().capabilities.manage).toBe(false);
    expect(fixtureState.events).toEqual(["start"]);
  });

  it("does not require a helper merely because an old managed directory exists", async () => {
    const f = await fixture();
    f.environment.CODEXHOST_LAUNCHER_EXECUTABLE = "";
    await mkdir(f.directory);
    const prepared = await f.prepare();
    expect(prepared.accountControl.snapshot().capabilities.reason).toBe("unsupported-storage");
    // No launch here: the helper-less transport uses the stock executable directly.
    expect(fixtureState.events).toEqual([]);
  });

  it.each(["transaction.json", "login.json"])(
    "blocks pending %s without a helper",
    async (name) => {
      const f = await fixture();
      f.environment.CODEXHOST_LAUNCHER_EXECUTABLE = "";
      await f.pending(name);
      const prepared = await f.prepare();
      await expect(prepared.officialRuntimeScope.start()).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(fixtureState.events).toEqual([]);
    },
  );

  it.each(["transaction.json", "login.json"])(
    "does not start over malformed pending %s",
    async (name) => {
      const f = await fixture();
      await f.seed(name, "malformed");
      const prepared = await f.prepare();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("unavailable");
      expect(fixtureState.events).toEqual([]);
      expect(f.files.peek(f.directory, name)).not.toBeNull();
    },
  );

  it.each(["transaction.json", "login.json"])(
    "recovers valid %s before admitting native work",
    async (name) => {
      const f = await fixture();
      await f.pending(name);
      const prepared = await f.prepare();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
      expect(f.files.peek(f.directory, name)).toBeNull();
      expect(fixtureState.events).toContain("verify");
      expect(stopNativeProcesses).not.toHaveBeenCalled();
    },
  );

  it.each(["transaction.json", "login.json"])(
    "retains missing-exit evidence for pending %s",
    async (name) => {
      const f = await fixture();
      await f.pending(name);
      await f.seed(".codexhost-process.json", {
        version: 1,
        nonce: randomUUID(),
        phase: "running",
        pid: 43,
        identity: "old",
      });
      const prepared = await f.prepare();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("unavailable");
      expect(fixtureState.events).toEqual([]);
      expect(f.files.peek(f.directory, name)).not.toBeNull();
      expect(f.files.peek(f.directory, ".codexhost-process.json")).not.toBeNull();
    },
  );

  it.each(["logout", "login"])(
    "checks historical exit before Settings %s can alter credentials",
    async (operation) => {
      const f = await fixture();
      const source = credential("a").serializeForNativeStore();
      f.files.seed(f.home, "auth.json", source);
      await f.seed(".codexhost-process.json", {
        version: 1,
        nonce: randomUUID(),
        phase: "running",
        pid: 43,
        identity: "old",
      });
      const prepared = await f.prepare();
      await prepared.accountControl.refresh?.();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
      await expect(
        operation === "logout"
          ? prepared.accountControl.logout()
          : prepared.accountControl.startLogin(),
      ).rejects.toThrow();
      expect(prepared.officialRuntimeScope.gate.phase).toBe("unavailable");
      expect(f.files.peek(f.home, "auth.json")?.toString()).toBe(source);
      expect(f.files.peek(f.directory, "transaction.json")).toBeNull();
      expect(f.files.peek(f.directory, "login.json")).toBeNull();
      expect(stopNativeProcesses).not.toHaveBeenCalled();
      expect(fixtureState.events.filter((event) => event === "start")).toHaveLength(1);
    },
  );

  it("does not interpret a missing historical receipt as proof of exit on clean startup", async () => {
    const f = await fixture();
    await f.seed(".codexhost-process.json", {
      version: 1,
      nonce: randomUUID(),
      phase: "running",
      pid: 43,
      identity: "old",
    });
    const prepared = await f.prepare();
    await prepared.accountControl.refresh?.();
    expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
    expect(f.files.peek(f.directory, ".codexhost-process.json")).not.toBeNull();
    expect(stopNativeProcesses).not.toHaveBeenCalled();
    await prepared.officialRuntimeScope.owner.stop();
    vi.mocked(stopNativeProcesses).mockRejectedValueOnce(new Error("exit unconfirmed"));
    await expect(fixtureState.externalStop?.()).rejects.toThrow("exit unconfirmed");
    expect(f.files.peek(f.directory, ".codexhost-process.json")).not.toBeNull();
    await fixtureState.externalStop?.();
    expect(f.files.peek(f.directory, ".codexhost-process.json")).toBeNull();
  });
});
