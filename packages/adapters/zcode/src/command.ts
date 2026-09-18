import { accessSync, constants } from "node:fs";
import {
  commandInvocation,
  resolveHarnessExecutable,
  VERSION_MANAGER_ROOTS,
  type HarnessDiscoverySpec,
} from "@codexhost/harness-discovery";
import { ZcodeError } from "./errors.js";

const cliSpec: HarnessDiscoverySpec = {
  id: "zcode",
  command: "zcode",
  commandEnvironmentVariable: "CODEXHOST_ZCODE_COMMAND",
  installRoots: {
    posix: [
      "~/.local/bin",
      "~/.npm-global/bin",
      VERSION_MANAGER_ROOTS,
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ],
    windows: ["${APPDATA}/npm", "~/.local/bin", VERSION_MANAGER_ROOTS],
  },
};
const desktopSpec: HarnessDiscoverySpec = {
  id: "zcode",
  command: "zcode.cjs",
  runnableCandidate: (candidate) => candidate.replace(/(\.cjs)\.(?:exe|cmd)$/iu, "$1"),
  installRoots: {
    posix: [
      "/Applications/ZCode.app/Contents/Resources/glm",
      "/Applications/Zcode.app/Contents/Resources/glm",
      "~/Applications/ZCode.app/Contents/Resources/glm",
      "/opt/ZCode/resources/glm",
      "/opt/zcode/resources/glm",
      "/usr/lib/zcode/resources/glm",
    ],
    windows: [
      "${LOCALAPPDATA}/Programs/ZCode/resources/glm",
      "${ProgramFiles}/ZCode/resources/glm",
    ],
  },
};
export function zcodeInvocation(
  environment: NodeJS.ProcessEnv,
  command?: string,
  platform: NodeJS.Platform = process.platform,
) {
  const input = { environment, platform, ...(command ? { command } : {}) };
  const readable = (file: string) => {
    try {
      accessSync(file, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  };
  const configured = command ?? environment.CODEXHOST_ZCODE_COMMAND;
  const resolution =
    resolveHarnessExecutable(
      cliSpec,
      input,
      configured && /\.[cm]?js$/iu.test(configured) ? { isExecutable: readable } : {},
    ) ??
    (configured
      ? undefined
      : resolveHarnessExecutable(desktopSpec, input, { isExecutable: readable }));
  if (!resolution)
    throw new ZcodeError(
      "notInstalled",
      "Install ZCode or set CODEXHOST_ZCODE_COMMAND to its native CLI or zcode.cjs runtime",
    );
  const args = ["app-server", "--stdio", "--surface", "terminal"];
  if (/\.[cm]?js$/iu.test(resolution.executable))
    return commandInvocation(
      process.execPath,
      [resolution.executable, ...args],
      environment,
      platform,
    );
  return commandInvocation(resolution.executable, args, environment, platform);
}
