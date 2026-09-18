import { describe, expect, it } from "vitest";
import { workBuddyInvocation } from "../src/command.js";

describe("WorkBuddy app discovery", () => {
  it.each([
    ["C:\\Users\\Test\\AppData\\Local\\Programs\\WorkBuddy", "WorkBuddy.exe"],
    ["C:\\Users\\Test\\AppData\\Local\\Programs\\WorkBuddy AI", "WorkBuddy AI.exe"],
    ["C:\\Program Files\\WorkBuddy", "WorkBuddy.exe"],
    ["D:\\Portable WorkBuddy", "WorkBuddy.exe"],
  ])("finds a Windows app in %s", (root, name) => {
    const executable = `${root}\\${name}`;
    const cli = `${root}\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy`;
    const invocation = workBuddyInvocation(
      {
        USERPROFILE: "C:\\Users\\Test",
        LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
        PATH: "D:\\Portable WorkBuddy",
      },
      true,
      {
        platform: "win32",
        isExecutable: (candidate) =>
          [executable, cli].some((file) => file.toLowerCase() === candidate.toLowerCase()),
      },
    );
    expect(invocation.command.toLowerCase()).toBe(executable.toLowerCase());
    expect(invocation.arguments).toEqual([cli, "--acp", "--no-session-persistence"]);
    expect(invocation.environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      WORKBUDDY_CONFIG_DIR: "C:\\Users\\Test\\.workbuddy-ai",
      CODEBUDDY_CONFIG_DIR: "C:\\Users\\Test\\.workbuddy-ai",
    });
  });

  it.each([
    "/Applications/WorkBuddy.app",
    "/Users/test/Applications/WorkBuddy AI.app",
    "/Users/test/Applications/WorkBuddy.app",
  ])("finds the macOS bundle %s", (root) => {
    const executable = `${root}/Contents/MacOS/Electron`;
    const cli = `${root}/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`;
    const invocation = workBuddyInvocation({ HOME: "/Users/test" }, false, {
      platform: "darwin",
      isExecutable: (candidate) => [executable, cli].includes(candidate),
    });
    expect(invocation.command).toBe(executable);
    expect(invocation.arguments).toEqual([cli, "--acp"]);
  });

  it("never combines an app executable with another installation's CLI", () => {
    const files = [
      "C:\\Users\\Test\\AppData\\Local\\Programs\\WorkBuddy AI\\WorkBuddy AI.exe",
      "C:\\Users\\Test\\AppData\\Local\\Programs\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy",
    ];
    expect(() =>
      workBuddyInvocation({ USERPROFILE: "C:\\Users\\Test" }, false, {
        platform: "win32",
        isExecutable: (candidate) => files.includes(candidate),
      }),
    ).toThrow("unavailable");
  });

  it("does not replace a missing explicit command with an installed app", () => {
    expect(() =>
      workBuddyInvocation(
        { USERPROFILE: "C:\\Users\\Test", CODEXHOST_WORKBUDDY_COMMAND: "C:\\missing.exe" },
        false,
        {
          platform: "win32",
          isExecutable: (candidate) => candidate !== "C:\\missing.exe",
        },
      ),
    ).toThrow("unavailable");
  });

  it("forwards the Windows product snapshot using Windows paths", () => {
    const root = "C:\\Users\\Test\\AppData\\Local\\Programs\\WorkBuddy";
    const config = "C:\\Users\\Test\\.workbuddy-ai";
    const cache = `${config}\\cache`;
    const snapshot = `${cache}\\acc-product-config-v3.json`;
    const invocation = workBuddyInvocation({ USERPROFILE: "C:\\Users\\Test" }, false, {
      platform: "win32",
      isExecutable: (candidate) =>
        [
          `${root}\\WorkBuddy.exe`,
          `${root}\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy`,
        ].includes(candidate),
      lstat: (candidate) => ({
        isDirectory: () => [config, cache].includes(candidate),
        isFile: () => candidate === snapshot,
        isSymbolicLink: () => false,
        mode: 0o666,
        size: 10,
        uid: 0,
      }),
    });
    expect(invocation.environment.ACC_PRODUCT_CONFIG_PATH).toBe(snapshot);
  });
});
