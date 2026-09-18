import { describe, expect, it } from "vitest";
import {
  WORKBUDDY_MACOS_CLI,
  WORKBUDDY_MACOS_ELECTRON,
  workBuddyEnvironment,
  workBuddyInvocation,
} from "../src/command.js";

describe("WorkBuddy command invocation", () => {
  it("uses only the macOS app-owned Electron and CLI by default", () => {
    const seen: string[] = [];
    const invocation = workBuddyInvocation({ HOME: "/Users/test", PATH: "/ordinary/bin" }, true, {
      platform: "darwin",
      isExecutable: (candidate) => {
        seen.push(candidate);
        return [WORKBUDDY_MACOS_ELECTRON, WORKBUDDY_MACOS_CLI].includes(candidate);
      },
    });

    expect(invocation.command).toBe(WORKBUDDY_MACOS_ELECTRON);
    expect(invocation.arguments).toEqual([
      WORKBUDDY_MACOS_CLI,
      "--acp",
      "--no-session-persistence",
    ]);
    expect(invocation.environment).toMatchObject({
      CODEBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
      WORKBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
      ELECTRON_RUN_AS_NODE: "1",
      DISABLE_AUTOUPDATER: "1",
    });
    expect(invocation.environment).not.toHaveProperty("CODEBUDDY_HOST");
    expect(invocation.environment).not.toHaveProperty("WORKBUDDY_DATA_FOLDER_NAME");
    expect(seen).toEqual([WORKBUDDY_MACOS_ELECTRON, WORKBUDDY_MACOS_CLI]);
  });

  it("honors the explicit WorkBuddy command without adding the bundled script", () => {
    const invocation = workBuddyInvocation(
      {
        HOME: "/Users/test",
        CODEXHOST_WORKBUDDY_COMMAND: "/custom/workbuddy-cli",
        CODEBUDDY_CONFIG_DIR: "/custom/codebuddy-root",
        WORKBUDDY_CONFIG_DIR: "/custom/workbuddy-root",
      },
      false,
      { platform: "darwin", isExecutable: (candidate) => candidate === "/custom/workbuddy-cli" },
    );

    expect(invocation.command).toBe("/custom/workbuddy-cli");
    expect(invocation.arguments).toEqual(["--acp"]);
    expect(invocation.environment).toMatchObject({
      CODEBUDDY_CONFIG_DIR: "/custom/workbuddy-root",
      WORKBUDDY_CONFIG_DIR: "/custom/workbuddy-root",
    });
    expect(invocation.environment).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  });

  it("keeps the WorkBuddy executable while replacing ACP arguments for native administration", () => {
    const invocation = workBuddyInvocation(
      { HOME: "/Users/test" },
      false,
      {
        platform: "darwin",
        isExecutable: (candidate) =>
          [WORKBUDDY_MACOS_ELECTRON, WORKBUDDY_MACOS_CLI].includes(candidate),
      },
      ["--resume", "source", "--fork-session", "--session-id", "target"],
    );

    expect(invocation.command).toBe(WORKBUDDY_MACOS_ELECTRON);
    expect(invocation.arguments).toEqual([
      WORKBUDDY_MACOS_CLI,
      "--resume",
      "source",
      "--fork-session",
      "--session-id",
      "target",
    ]);
  });

  it("does not fall back to a PATH CodeBuddy on unsupported platforms", () => {
    expect(() =>
      workBuddyInvocation({ HOME: "/home/test", PATH: "/ordinary/codebuddy/bin" }, false, {
        platform: "linux",
        isExecutable: () => true,
      }),
    ).toThrow("CODEXHOST_WORKBUDDY_COMMAND");
  });

  it("uses WorkBuddy's root when only WORKBUDDY_CONFIG_DIR is configured", () => {
    expect(
      workBuddyEnvironment({ HOME: "/Users/test", WORKBUDDY_CONFIG_DIR: "/workbuddy" }),
    ).toMatchObject({
      CODEBUDDY_CONFIG_DIR: "/workbuddy",
      WORKBUDDY_CONFIG_DIR: "/workbuddy",
    });
    expect(workBuddyEnvironment({ HOME: "/Users/test" }).CODEBUDDY_CONFIG_DIR).toBe(
      "/Users/test/.workbuddy-ai",
    );
  });

  it("does not inherit a global CodeBuddy history root or overwrite updater policy", () => {
    expect(
      workBuddyEnvironment({
        HOME: "/Users/test",
        CODEBUDDY_CONFIG_DIR: "/ordinary-codebuddy",
        DISABLE_AUTOUPDATER: "0",
      }),
    ).toMatchObject({
      CODEBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
      WORKBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
      DISABLE_AUTOUPDATER: "0",
    });
  });

  it.each(["", "   "])("treats an empty WorkBuddy root %j as unset", (configuredRoot) => {
    expect(
      workBuddyEnvironment({ HOME: "/Users/test", WORKBUDDY_CONFIG_DIR: configuredRoot }),
    ).toMatchObject({
      CODEBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
      WORKBUDDY_CONFIG_DIR: "/Users/test/.workbuddy-ai",
    });
  });
});
