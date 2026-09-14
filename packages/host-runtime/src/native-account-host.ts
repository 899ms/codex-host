import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import type { CodexAccountControl } from "./account/codex-account-control.js";
import { NativeAccountStore } from "./account/native-account-store.js";
import { NativeCodexAccounts } from "./account/native-codex-accounts.js";
import { OfficialAccountRuntime } from "./account/official-account-runtime.js";
import { createDeviceCodeLogin } from "./account/native-device-code-login.js";
import { officialEnvironment } from "./app-server-host.js";
import { OfficialRuntimeScope } from "./codex-runtime/official-runtime-scope.js";
import { createOwnedLoopbackBackend } from "./codex-runtime/owned-official-backends.js";
import { stopNativeProcesses } from "./native-process-stop.js";
export interface PreparedLocalCodex {
  officialRuntimeScope: OfficialRuntimeScope;
  accountControl: CodexAccountControl;
  close(): Promise<void>;
}
async function canonicalCodexHome(home: string): Promise<string> {
  const absolute = path.resolve(home);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonicalCodexHome(parent), path.basename(absolute));
  }
}
export async function prepareLocalCodex(input: {
  stockCodexPath: string;
  arguments: string[];
  environment: NodeJS.ProcessEnv;
  diagnosticOutput: Writable;
}): Promise<PreparedLocalCodex> {
  const home = await canonicalCodexHome(
    input.environment.CODEX_HOME ?? path.join(homedir(), ".codex"),
  );
  const scope = new OfficialRuntimeScope({
    permanentHome: home,
    diagnosticOutput: input.diagnosticOutput,
    createBackend: () =>
      createOwnedLoopbackBackend({
        stockCodexPath: input.stockCodexPath,
        cwd: home,
        arguments: input.arguments,
        environment: { ...officialEnvironment(input.environment), CODEX_HOME: home },
      }),
  });
  try {
    await scope.start();
  } catch (error) {
    await scope.close();
    throw error;
  }
  const store = new NativeAccountStore({ home });
  const runtime = new OfficialAccountRuntime({
    owner: scope.owner,
    environment: input.environment,
    readCredentials: () => store.readCredentials(),
    stopExternalProcesses: async () => {
      const launcher = input.environment.CODEXHOST_LAUNCHER_EXECUTABLE;
      if (launcher && path.isAbsolute(launcher))
        await stopNativeProcesses({
          launcher,
          executableNames: [path.basename(input.stockCodexPath), "codex", "codex.exe"],
          environment: input.environment,
        });
      else
        input.diagnosticOutput.write(
          "codexhost: external Codex process stop skipped (launcher unavailable)\n",
        );
    },
  });
  const accounts = new NativeCodexAccounts({
    store,
    runtime,
    diagnosticOutput: input.diagnosticOutput,
    startDeviceCodeLogin: createDeviceCodeLogin(input),
  });
  void accounts.initialize().catch(() => {
    input.diagnosticOutput.write("codexhost: Codex Account initialization failed\n");
  });
  return {
    officialRuntimeScope: scope,
    accountControl: accounts,
    close: async () => {
      try {
        await accounts.close();
      } finally {
        await scope.close();
      }
    },
  };
}
