import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  codeBuddyProjectSlug,
  CodeBuddyError,
  type CodeBuddyClient,
  type CodeBuddyClientFactory,
} from "@codexhost/adapter-codebuddy";
import { nativeSessionRefSchema } from "@codexhost/shared-contracts";
import { WorkBuddyAdapter } from "../src/workbuddy-adapter.js";

const adapters: WorkBuddyAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
});

const configOptions = [
  {
    id: "model",
    currentValue: "native/model",
    options: [{ value: "native/model", name: "Native Model" }],
  },
  {
    id: "mode",
    currentValue: "default",
    options: ["default", "plan", "fullAccess"].map((value) => ({ value, name: value })),
  },
  {
    id: "thought_level",
    currentValue: "low",
    options: ["low", "high"].map((value) => ({ value, name: value })),
  },
];

function fakeFactory(): CodeBuddyClientFactory {
  return () =>
    ({
      initialize: async () => ({ protocolVersion: 1 }),
      open: async (_cwd, sessionId) => ({
        sessionId: sessionId ?? "workbuddy-native",
        configOptions,
      }),
      configure: async (_sessionId, id, value) => ({
        configOptions: configOptions.map((option) => ({
          ...option,
          currentValue: option.id === id ? value : option.currentValue,
        })),
      }),
      prompt: async () => ({ stopReason: "end_turn" }),
      cancel: async () => {},
      answer: async () => {},
      close: async () => {},
    }) satisfies CodeBuddyClient;
}

describe("WorkBuddy Adapter identity", () => {
  it("opens WorkBuddy Sessions with WorkBuddy native identity and honest history capabilities", async () => {
    const adapter = new WorkBuddyAdapter({ clientFactory: fakeFactory() });
    adapters.push(adapter);
    const opened = await adapter.open({ kind: "create", cwd: process.cwd(), environment: {} });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(adapter.harnessId).toBe("workbuddy");
    expect(opened.value).toMatchObject({
      harnessId: "workbuddy",
      initialState: {
        nativeRef: {
          harnessId: "workbuddy",
          nativeSessionId: "workbuddy-native",
          formatVersion: 1,
        },
      },
      capabilities: {
        history: { fork: true, forkAcrossCwd: true, rollbackLastTurn: true },
        subagents: { observe: true, readTranscript: true },
      },
    });
  });

  it("rejects CodeBuddy refs instead of crossing Harness history", async () => {
    const adapter = new WorkBuddyAdapter({ clientFactory: fakeFactory() });
    adapters.push(adapter);
    expect(
      await adapter.open({
        kind: "resume",
        cwd: process.cwd(),
        nativeRef: nativeSessionRefSchema.parse({
          harnessId: "codebuddy",
          nativeSessionId: "native",
          formatVersion: 1,
        }),
      }),
    ).toMatchObject({
      error: { code: "invalidRequest", message: expect.stringContaining("WorkBuddy") },
    });
  });

  it("reads default history only from .workbuddy-ai", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "codexhost-workbuddy-"));
    const cwd = await mkdtemp(path.join(tmpdir(), "codexhost-workbuddy-cwd-"));
    const sessionId = "workbuddy-history";
    const slug = codeBuddyProjectSlug(cwd);
    const workBuddyProject = path.join(home, ".workbuddy-ai", "projects", slug);
    const codeBuddyProject = path.join(home, ".codebuddy", "projects", slug);
    await Promise.all([
      mkdir(workBuddyProject, { recursive: true }),
      mkdir(codeBuddyProject, { recursive: true }),
    ]);
    const rows = (input: string) =>
      [
        { type: "message", role: "user", id: "user", sessionId, cwd, content: input },
        {
          type: "message",
          role: "assistant",
          id: "assistant",
          parentId: "user",
          sessionId,
          cwd,
          status: "completed",
          content: "done",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n");
    await Promise.all([
      writeFile(path.join(workBuddyProject, `${sessionId}.jsonl`), rows("from WorkBuddy")),
      writeFile(path.join(codeBuddyProject, `${sessionId}.jsonl`), rows("from CodeBuddy")),
    ]);

    const adapter = new WorkBuddyAdapter({
      environment: { HOME: home, CODEBUDDY_CONFIG_DIR: path.join(home, ".codebuddy") },
      clientFactory: fakeFactory(),
    });
    adapters.push(adapter);
    const opened = await adapter.open({
      kind: "resume",
      cwd,
      nativeRef: nativeSessionRefSchema.parse({
        harnessId: "workbuddy",
        nativeSessionId: sessionId,
        formatVersion: 1,
      }),
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await opened.value.readSnapshot()).toMatchObject({
      value: { turns: [{ input: [{ text: "from WorkBuddy" }] }] },
    });
  });

  it("brands authentication failures as WorkBuddy", async () => {
    const adapter = new WorkBuddyAdapter({
      clientFactory: () => {
        throw new CodeBuddyError("authenticationRequired", "Authentication required");
      },
    });
    adapters.push(adapter);
    expect(await adapter.inspect()).toMatchObject({
      status: "unavailable",
      error: { code: "authenticationRequired", message: "WorkBuddy: Authentication required" },
    });
  });
});
