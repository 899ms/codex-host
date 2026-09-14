import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type {
  CodexAccountControl,
  UnavailableCodexAccountReason,
} from "./account/codex-account-control.js";
import {
  SingleNativeCodexAccount,
  UnavailableCodexAccounts,
} from "./account/codex-account-control.js";
import { canonicalCodexHome } from "./account/native-account-layout.js";
import { BackgroundCodexAccounts } from "./account/background-codex-accounts.js";
import { collectLegacyNativeAccounts } from "./account/collect-legacy-native-accounts.js";
import { NativeAccountStore } from "./account/native-account-store.js";
import { NativeAccountError } from "./account/native-profile-vault.js";
import { NativeCodexAccounts } from "./account/native-codex-accounts.js";
import { OfficialAccountRuntime } from "./account/official-account-runtime.js";
import { officialEnvironment } from "./app-server-host.js";
import { OfficialProcessRecord } from "./codex-runtime/official-process-record.js";
import {
  OfficialRuntimeScope,
  createOwnedConnectionBackend,
} from "./codex-runtime/official-runtime-scope.js";
import { createOwnedLoopbackBackend } from "./codex-runtime/owned-official-backends.js";
import type { OwnedOfficialBackend } from "./codex-runtime/official-runtime-owner.js";
import { NativePrivateFiles } from "./native-private-files.js";
import type { ProcessExitReceipt } from "./native-process-relay.js";
import { NativeSecretKeys } from "./native-secret-keys.js";
import { readNativeProcessIdentity } from "./native-process-identity.js";
import { stopNativeProcesses } from "./native-process-stop.js";
import { spawnOfficialAppServerConnection } from "./official-app-server-connection.js";
import { officialLoopbackListenerArguments } from "./remote-app-server.js";
import { createLoopbackOfficialAppServerListener } from "./remote-official-app-server.js";
import { createRemoteOfficialAppServerConnection } from "./remote-official-connection.js";

export interface PreparedLocalCodex {
  officialRuntimeScope: OfficialRuntimeScope;
  accountControl: CodexAccountControl;
  close(): Promise<void>;
}
interface LocalCodexOptions {
  stockCodexPath: string;
  arguments: string[];
  environment: NodeJS.ProcessEnv;
  sharedListener: boolean;
  diagnosticOutput: Writable;
}
const discardNativeDiagnostics = (): Writable =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
function stagingEnvironment(source: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const allowed = new Set([
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "PATH",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(([name]) => allowed.has(name.toUpperCase())),
    ),
    CODEX_HOME: home,
  };
}
async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return false;
    throw error;
  }
}
function blocked(
  home: string,
  output: Writable,
  reason: UnavailableCodexAccountReason,
): PreparedLocalCodex {
  output.write(`codexhost: Codex Account startup blocked (${reason})\n`);
  const scope = new OfficialRuntimeScope({
    permanentHome: home,
    diagnosticOutput: output,
    managedAccounts: true,
    createBackend() {
      throw new Error("Official Codex requires recovery");
    },
  });
  return {
    officialRuntimeScope: scope,
    accountControl: new UnavailableCodexAccounts(reason, () => ({
      phase: scope.gate.phase,
      revision: scope.gate.revision,
    })),
    close: () => scope.close(),
  };
}
function nativeListener(input: LocalCodexOptions, home: string): OwnedOfficialBackend {
  const token = randomBytes(32).toString("base64url");
  const listener = createLoopbackOfficialAppServerListener({
    stockCodexPath: input.stockCodexPath,
    arguments: [
      ...officialLoopbackListenerArguments(input.arguments),
      "--ws-auth",
      "capability-token",
      "--ws-token-sha256",
      createHash("sha256").update(token).digest("hex"),
    ],
    environment: { ...officialEnvironment(input.environment), CODEX_HOME: home },
    diagnosticOutput: discardNativeDiagnostics(),
  });
  let endpoint: string | undefined;
  return {
    closed: listener.closed,
    get processId() {
      return listener.processId;
    },
    async start() {
      endpoint = await listener.listen();
    },
    async connect() {
      if (!endpoint) throw new Error("Official listener unavailable");
      return createRemoteOfficialAppServerConnection(endpoint, { capabilityToken: token });
    },
    stop: () => listener.close(),
  };
}
function nativeFallback(
  input: LocalCodexOptions,
  home: string,
  reason: UnavailableCodexAccountReason,
): PreparedLocalCodex {
  const scope = new OfficialRuntimeScope({
    permanentHome: home,
    diagnosticOutput: input.diagnosticOutput,
    createBackend: () =>
      input.sharedListener
        ? nativeListener(input, home)
        : createOwnedConnectionBackend(() =>
            spawnOfficialAppServerConnection({
              stockCodexPath: input.stockCodexPath,
              arguments: input.arguments,
              environment: { ...officialEnvironment(input.environment), CODEX_HOME: home },
            }),
          ),
  });
  const control = new SingleNativeCodexAccount(() => ({
    version: 2,
    currentAccountId: "native",
    phase: scope.gate.phase,
    revision: scope.gate.revision,
    capabilities: {
      manage: false,
      switch: false,
      login: false,
      delete: false,
      logout: false,
      recover: false,
      reason,
    },
    accounts: [{ accountId: "native", label: "Native Codex Account" }],
  }));
  return {
    officialRuntimeScope: scope,
    accountControl: control,
    close: async () => {
      await scope.close();
    },
  };
}

/** Existence only: unreadable records are unknown, not a clean startup. */
async function hasPendingMutation(root: string): Promise<boolean> {
  return (
    (await exists(path.join(root, "transaction.json"))) ||
    (await exists(path.join(root, "login.json")))
  );
}

/** Ordinary startup owns a backend, not an Account recovery transaction. */
export async function prepareLocalCodex(input: LocalCodexOptions): Promise<PreparedLocalCodex> {
  const home = await canonicalCodexHome(
    input.environment.CODEX_HOME ?? path.join(homedir(), ".codex"),
  );
  const root = path.join(home, ".codexhost-native-accounts");
  let pending: boolean;
  try {
    pending = await hasPendingMutation(root);
  } catch {
    return blocked(home, input.diagnosticOutput, "recovery-required");
  }
  const launcher = input.environment.CODEXHOST_LAUNCHER_EXECUTABLE;
  if (!launcher || !path.isAbsolute(launcher)) {
    return pending
      ? blocked(home, input.diagnosticOutput, "recovery-required")
      : nativeFallback(input, home, "unsupported-storage");
  }

  // Current-process exit proof must not depend on a usable collection or an old
  // supervisor record. The private temporary directory contains no credentials.
  const processDirectory = await realpath(
    await mkdtemp(path.join(tmpdir(), "codexhost-official-")),
  );
  const processFiles = new NativePrivateFiles({ launcher, environment: input.environment });
  const files = new NativePrivateFiles({ launcher, environment: input.environment });
  let accounts: NativeCodexAccounts | undefined;
  const store = new NativeAccountStore({
    home,
    files,
    homeFiles: files.withReadOnlyDirectoryAccess(),
    keys: new NativeSecretKeys({ launcher, environment: input.environment }),
    onLeaseLost: () => {
      // Collection ownership loss cannot disable an otherwise running Codex.
      // An in-flight credential mutation still fails closed.
      if (scope?.gate.phase === "changing") {
        scope.gate.unavailable();
        void scope.owner.stop().catch(() => undefined);
      }
    },
  });
  const recordOptions = {
    identity: (pid: number) => readNativeProcessIdentity(launcher, pid),
    supervisorExitClosesProcessTree: process.platform === "win32",
  };
  const recoveryRecord = new OfficialProcessRecord({
    ...recordOptions,
    files,
    sharedCodexHome: root,
    assertOwnership: () => store.assertFileOwnership(),
  });
  const scope: OfficialRuntimeScope = new OfficialRuntimeScope({
    permanentHome: home,
    managedAccounts: pending,
    diagnosticOutput: input.diagnosticOutput,
    createBackend: (role) => {
      // Backends started by a mutation need a durable crash witness. An ordinary
      // backend is stopped with its own receipt before any Journal is written.
      const changing = scope.gate.phase === "changing";
      const create = (receipt: ProcessExitReceipt) =>
        createOwnedLoopbackBackend({
          stockCodexPath: input.stockCodexPath,
          arguments: officialLoopbackListenerArguments(
            role.kind === "staging" ? ["app-server"] : input.arguments,
          ),
          cwd: role.home,
          environment:
            role.kind === "staging"
              ? stagingEnvironment(input.environment, role.home)
              : { ...officialEnvironment(input.environment), CODEX_HOME: role.home },
          diagnosticOutput: discardNativeDiagnostics(),
          supervision: { launcher, files: changing ? files : processFiles, receipt },
        });
      return changing
        ? recoveryRecord.wrap(create)
        : create({
            directory: processDirectory,
            name: ".codexhost-process-exit.json",
            tag: randomUUID(),
          });
    },
  });
  const preservePendingRecovery = async (): Promise<void> => {
    // A record may appear between the lightweight check and collection opening.
    // A collection failure must not conceal that new recovery obligation.
    if (await hasPendingMutation(root).catch(() => true)) {
      scope.gate.unavailable();
      await scope.owner.stop();
    }
  };
  const initializeAccounts = async (): Promise<CodexAccountControl> => {
    try {
      if (!(await store.open({ allowLocked: true })))
        throw new NativeAccountError("keyring-unavailable");
      const runtime = new OfficialAccountRuntime({
        owner: scope.owner,
        sharedCodexHome: home,
        environment: input.environment,
        readCredentials: (directory) => store.readCredentials(directory),
        reconcilePreviousWriter: () => recoveryRecord.reconcile(),
        stopExternalProcesses: async () => {
          await stopNativeProcesses({
            launcher,
            executableNames: [path.basename(input.stockCodexPath), "codex", "codex.exe"],
            environment: input.environment,
          });
          // A dead supervisor alone proves nothing. Only the successful native
          // writer census/termination allows retiring a clean historical witness.
          if (!(await store.readJournal()) && !(await store.readStage()))
            await recoveryRecord.reconcile({ externalWritersStopped: true });
        },
      });
      if (!pending) await runtime.checkCredentialStorage();
      accounts = new NativeCodexAccounts({ store, runtime });
      try {
        await accounts.initialize();
        await collectLegacyNativeAccounts(
          store,
          path.resolve(input.environment.CODEXHOST_DATA_DIR ?? path.join(homedir(), ".codexhost")),
        );
      } catch {
        await preservePendingRecovery();
        input.diagnosticOutput.write(
          pending
            ? "codexhost: Codex Account recovery is required\n"
            : "codexhost: Codex Account collection synchronization failed\n",
        );
      }
      return accounts;
    } catch {
      await preservePendingRecovery();
      input.diagnosticOutput.write("codexhost: Codex Account collection is unavailable\n");
      await store.close();
      return new UnavailableCodexAccounts(
        pending ? "recovery-required" : "unsupported-storage",
        () => ({
          phase: scope.gate.phase,
          revision: scope.gate.revision,
        }),
      );
    }
  };
  let background: BackgroundCodexAccounts | undefined;
  let control: CodexAccountControl;
  if (pending) {
    // No ordinary backend is launched until the actual Journal/stage is resolved.
    control = await initializeAccounts();
  } else {
    try {
      await scope.start();
    } catch (error) {
      await scope.close();
      await rm(processDirectory, { recursive: true, force: true });
      throw error;
    }
    background = new BackgroundCodexAccounts(
      new UnavailableCodexAccounts("unsupported-storage", () => ({
        phase: scope.gate.phase,
        revision: scope.gate.revision,
      })),
      initializeAccounts,
    );
    control = background;
  }
  return {
    officialRuntimeScope: scope,
    accountControl: control,
    close: async () => {
      await background?.settled();
      await accounts?.close();
      await scope.close();
      await store.close();
      await rm(processDirectory, { recursive: true, force: true });
    },
  };
}
