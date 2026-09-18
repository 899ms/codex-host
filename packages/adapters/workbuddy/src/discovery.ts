import {
  harnessCandidates,
  targetPath,
  type HarnessDiscoverySpec,
} from "@codexhost/harness-discovery";

export const WORKBUDDY_MACOS_ELECTRON = "/Applications/WorkBuddy AI.app/Contents/MacOS/Electron";
export const WORKBUDDY_MACOS_CLI =
  "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";

const windowsRoots = [
  "${LOCALAPPDATA}/Programs/WorkBuddy AI",
  "${LOCALAPPDATA}/Programs/WorkBuddy",
  "${ProgramFiles}/WorkBuddy AI",
  "${ProgramFiles}/WorkBuddy",
];
const macSpec: HarnessDiscoverySpec = {
  id: "workbuddy",
  command: "Electron",
  installRoots: {
    posix: [
      "/Applications/WorkBuddy AI.app/Contents/MacOS",
      "/Applications/WorkBuddy.app/Contents/MacOS",
      "~/Applications/WorkBuddy AI.app/Contents/MacOS",
      "~/Applications/WorkBuddy.app/Contents/MacOS",
    ],
  },
};

/** Discover app-owned runtime/script pairs; an unrelated PATH CodeBuddy is never a candidate. */
export function resolveWorkBuddyBundle(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isExecutable: (candidate: string) => boolean,
): { executable: string; cli: string } | undefined {
  const specs: HarnessDiscoverySpec[] =
    platform === "darwin"
      ? [macSpec]
      : platform === "win32"
        ? ["WorkBuddy AI", "WorkBuddy"].map((command) => ({
            id: "workbuddy",
            command,
            installRoots: { windows: windowsRoots },
          }))
        : [];
  const paths = targetPath(platform);
  for (const spec of specs) {
    for (const { candidate, source } of harnessCandidates(spec, { environment, platform })) {
      // A random Electron on PATH is not WorkBuddy; Windows .cmd shims are not Electron runtimes.
      if (platform === "darwin" && source !== "install-root") continue;
      if (platform === "win32" && paths.extname(candidate).toLowerCase() !== ".exe") continue;
      if (!isExecutable(candidate)) continue;
      const resources =
        platform === "darwin"
          ? paths.resolve(paths.dirname(candidate), "..", "Resources")
          : paths.join(paths.dirname(candidate), "resources");
      const cli = paths.join(resources, "app.asar.unpacked", "cli", "bin", "codebuddy");
      if (isExecutable(cli)) return { executable: candidate, cli };
    }
  }
  return undefined;
}
