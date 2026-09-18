import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CodeBuddyInvocationFactory } from "../src/acp-client.js";
import { copyCodeBuddySession } from "../src/derivation.js";

const invocation: CodeBuddyInvocationFactory = (environment, _ephemeral, args = []) => ({
  command: process.execPath,
  arguments: [path.resolve("packages/adapters/codebuddy/test/fixtures/copy.mjs"), ...args],
  environment,
  windowsVerbatimArguments: false,
});

const run = (environment: NodeJS.ProcessEnv = process.env, signal = new AbortController().signal) =>
  copyCodeBuddySession(process.cwd(), "source", "target", environment, signal, invocation);

describe("native EOF history copy process", () => {
  it("closes stdin without a prompt and confirms a model-free target identity", async () => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(["identity", "model", "invalid", "exit"])("rejects %s evidence", async (mode) => {
    await expect(run({ ...process.env, COPY_TEST_MODE: mode })).rejects.toThrow();
  });

  it("accepts replayed historical usage without treating it as a model request", async () => {
    await expect(run({ ...process.env, COPY_TEST_MODE: "usage" })).resolves.toBeUndefined();
  });

  it("kills and waits for the copy process on shutdown", async () => {
    const controller = new AbortController();
    const pending = run({ ...process.env, COPY_TEST_MODE: "hang" }, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("interrupted");
  });
});
