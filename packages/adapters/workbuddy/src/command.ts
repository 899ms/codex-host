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
}

export function workBuddyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configuredRoot = environment.WORKBUDDY_CONFIG_DIR;
  const root = configuredRoot?.trim()
    ? configuredRoot
    : path.join(environment.HOME || environment.USERPROFILE || homedir(), ".workbuddy-ai");
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
  const childEnvironment = bundled
    ? { ...configuredEnvironment, ELECTRON_RUN_AS_NODE: "1" }
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
