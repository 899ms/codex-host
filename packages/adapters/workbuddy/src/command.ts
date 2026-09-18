import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CodeBuddyError, type CodeBuddyInvocationFactory } from "@codexhost/adapter-codebuddy";
import {
  commandInvocation,
  environmentValue,
  isExecutableFile,
  resolveHarnessExecutable,
  withNodeRuntimeOnPath,
  type HarnessDiscoverySpec,
} from "@codexhost/harness-discovery";
import { workBuddyDelegationArguments } from "./delegation.js";

export const WORKBUDDY_MACOS_ELECTRON = "/Applications/WorkBuddy AI.app/Contents/MacOS/Electron";
export const WORKBUDDY_MACOS_CLI =
  "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";

export const workBuddyDiscoverySpec: HarnessDiscoverySpec = {
  id: "workbuddy",
  // An absolute app-owned default deliberately prevents discovery of an unrelated PATH codebuddy.
  command: WORKBUDDY_MACOS_ELECTRON,
  commandEnvironmentVariable: "CODEXHOST_WORKBUDDY_COMMAND",
};

interface WorkBuddyInvocationDependencies {
  platform?: NodeJS.Platform;
  isExecutable?: (candidate: string) => boolean;
  lstat?: (candidate: string) => {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    mode: number;
    size: number;
    uid: number;
  };
  getuid?: () => number | undefined;
}

const WORKBUDDY_PRODUCT_CONFIG_PATH_ENV = "ACC_PRODUCT_CONFIG_PATH";
const WORKBUDDY_PRODUCT_CONFIG_INLINE_ENVS = [
  "ACC_PRODUCT_CONFIG_V3",
  "ACC_PRODUCT_CONFIG_V2",
  "ACC_PRODUCT_CONFIG",
] as const;
const WORKBUDDY_PRODUCT_CONFIG_CACHE = path.join("cache", "acc-product-config-v3.json");

function bundledProductConfigPath(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  dependencies: WorkBuddyInvocationDependencies,
): string | undefined {
  if (
    environment[WORKBUDDY_PRODUCT_CONFIG_PATH_ENV] !== undefined ||
    WORKBUDDY_PRODUCT_CONFIG_INLINE_ENVS.some((name) => environment[name] !== undefined)
  )
    return;

  const root = environment.WORKBUDDY_CONFIG_DIR;
  if (!root) return;
  const candidate = path.join(root, WORKBUDDY_PRODUCT_CONFIG_CACHE);
  try {
    const inspect = dependencies.lstat ?? lstatSync;
    const uid = (dependencies.getuid ?? (() => process.getuid?.()))();
    for (const directory of [root, path.dirname(candidate)]) {
      const metadata = inspect(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
      if (platform !== "win32") {
        if ((metadata.mode & 0o022) !== 0) return;
        if (uid !== undefined && metadata.uid !== uid) return;
      }
    }
    const metadata = inspect(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) return;
    if (platform !== "win32") {
      if ((metadata.mode & 0o077) !== 0) return;
      if (uid !== undefined && metadata.uid !== uid) return;
    }
    return candidate;
  } catch {
    return;
  }
}

export function workBuddyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configuredRoot = environment.WORKBUDDY_CONFIG_DIR;
  const root = path.resolve(
    configuredRoot?.trim()
      ? configuredRoot
      : path.join(environment.HOME || environment.USERPROFILE || homedir(), ".workbuddy-ai"),
  );
  return {
    ...environment,
    // The bundled core reads CODEBUDDY_CONFIG_DIR. Force both names to one
    // WorkBuddy-owned root so a global CodeBuddy setting cannot leak history.
    CODEBUDDY_CONFIG_DIR: root,
    WORKBUDDY_CONFIG_DIR: root,
    DISABLE_AUTOUPDATER: environment.DISABLE_AUTOUPDATER ?? "1",
  };
}

export function workBuddyInvocation(
  environment: NodeJS.ProcessEnv,
  ephemeral: boolean,
  dependenciesOrArguments: WorkBuddyInvocationDependencies | string[] = {},
  argumentsOverride?: string[],
): ReturnType<CodeBuddyInvocationFactory> {
  const dependencies = Array.isArray(dependenciesOrArguments) ? {} : dependenciesOrArguments;
  const nativeArguments = Array.isArray(dependenciesOrArguments)
    ? dependenciesOrArguments
    : argumentsOverride;
  const platform = dependencies.platform ?? process.platform;
  const configured =
    environmentValue(environment, "CODEXHOST_WORKBUDDY_COMMAND")?.trim() || undefined;
  if (!configured && platform !== "darwin")
    throw new CodeBuddyError(
      "notInstalled",
      "WorkBuddy CLI was not configured; set CODEXHOST_WORKBUDDY_COMMAND",
    );
  const isExecutable =
    dependencies.isExecutable ?? ((candidate: string) => isExecutableFile(candidate, platform));
  const resolved = resolveHarnessExecutable(
    workBuddyDiscoverySpec,
    { environment, platform, command: configured ?? WORKBUDDY_MACOS_ELECTRON },
    { isExecutable },
  );
  if (!resolved)
    throw new CodeBuddyError("notInstalled", "WorkBuddy AI app or its bundled CLI is unavailable");

  const bundled = !configured;
  if (bundled && !isExecutable(WORKBUDDY_MACOS_CLI))
    throw new CodeBuddyError("notInstalled", "WorkBuddy AI bundled CLI is unavailable");
  const configuredEnvironment = withNodeRuntimeOnPath(
    workBuddyEnvironment(environment),
    process.execPath,
    platform,
  );
  const productConfigPath = bundled
    ? bundledProductConfigPath(configuredEnvironment, platform, dependencies)
    : undefined;
  const childEnvironment = bundled
    ? {
        ...configuredEnvironment,
        ...(productConfigPath ? { [WORKBUDDY_PRODUCT_CONFIG_PATH_ENV]: productConfigPath } : {}),
        ELECTRON_RUN_AS_NODE: "1",
      }
    : configuredEnvironment;
  return {
    ...commandInvocation(
      resolved.executable,
      [
        ...(bundled ? [WORKBUDDY_MACOS_CLI] : []),
        ...(nativeArguments ?? [
          "--acp",
          ...(ephemeral ? ["--no-session-persistence"] : []),
          ...workBuddyDelegationArguments(childEnvironment, ephemeral),
        ]),
      ],
      childEnvironment,
      platform,
    ),
    environment: childEnvironment,
  };
}
