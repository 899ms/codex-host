import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { copyCodeBuddySession } from "../src/derivation.js";
vi.mock("../src/command.js", () => ({
  codeBuddyInvocation: (environment: NodeJS.ProcessEnv, _ephemeral: boolean, args: string[]) => ({
    command: process.execPath,
    arguments: [path.resolve("packages/adapters/codebuddy/test/fixtures/copy.mjs"), ...args],
    environment,
    windowsVerbatimArguments: false,
  }),
}));
describe("native EOF history copy process", () => {
  it("closes stdin without sending any prompt and checks the confirmed target identity", async () => {
    await expect(
      copyCodeBuddySession(
        process.cwd(),
        "source",
        "target",
        process.env,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });
  it.each(["identity", "model", "invalid", "exit"])("rejects %s evidence", async (mode) => {
    await expect(
      copyCodeBuddySession(
        process.cwd(),
        "source",
        "target",
        { ...process.env, COPY_TEST_MODE: mode },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("accepts replayed historical usage without treating it as a new model request", async () => {
    await expect(
      copyCodeBuddySession(
        process.cwd(),
        "source",
        "target",
        { ...process.env, COPY_TEST_MODE: "usage" },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });
  it("kills and waits for the process on shutdown", async () => {
    const controller = new AbortController();
    const pending = copyCodeBuddySession(
      process.cwd(),
      "source",
      "target",
      { ...process.env, COPY_TEST_MODE: "hang" },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("interrupted");
  });
});
