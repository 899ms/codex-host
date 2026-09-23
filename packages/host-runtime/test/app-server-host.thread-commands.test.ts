import { describe, expect, it, vi } from "vitest";
import type { HarnessCommandInvocation, HarnessResult } from "@codexhost/harness-adapter";
import {
  harnessCommandDescriptorSchema,
  hostTurnIdSchema,
  type HarnessCommandCatalog,
} from "@codexhost/shared-contracts";

import {
  createFixture,
  requestId,
  startPiThread,
  startPiTurn,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

const staticCommand = harnessCommandDescriptorSchema.parse({
  id: "fake.compact",
  invocation: "/compact",
  label: "Compact",
  argumentMode: "none",
});
const liveSkill = harnessCommandDescriptorSchema.parse({
  id: "fake.slash.review",
  invocation: "/review",
  label: "review",
  argumentMode: "text",
  kind: "skill",
});

describe("Thread command catalog", () => {
  it.each([
    ["autonomous Turn starts", -32072],
    ["commands become unavailable", -32078],
  ] as const)(
    "preserves command admission errors when %s during catalog loading",
    async (race, code) => {
      const fixture = createFixture();
      const catalog = Promise.withResolvers<HarnessResult<HarnessCommandCatalog>>();
      try {
        const threadId = await startPiThread(fixture);
        const session = fixture.adapter.sessions[0];
        if (!session) throw new Error("Fake Session was not opened");
        const list = vi.fn(() => catalog.promise);
        const execute = vi.fn(async ({ turnId }: HarnessCommandInvocation) => ({
          ok: true as const,
          value: { turnId },
        }));
        session.commands = { list, execute };
        writeRequest(fixture.desktopInput, {
          id: 2,
          method: "codexhost/thread/command/execute",
          params: { threadId, commandId: staticCommand.id },
        });
        await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
        if (race === "autonomous Turn starts") {
          const heldCompletion = vi
            .spyOn(session, "succeedTurn")
            .mockImplementationOnce(() => undefined);
          const turnId = hostTurnIdSchema.parse("catalog-race-autonomous");
          session.publishAutonomousTurn(turnId, [{ type: "text", text: "background work" }]);
          heldCompletion.mockRestore();
          await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", turnId));
        } else {
          delete session.commands;
        }
        catalog.resolve({ ok: true, value: { commands: [staticCommand] } });
        await expect(
          fixture.collector.waitFor((message) => requestId(message, 2)),
        ).resolves.toMatchObject({
          error: {
            code,
            message:
              race === "autonomous Turn starts"
                ? "External Thread already has an active operation"
                : "External Harness does not expose commands",
          },
        });
        expect(execute).not.toHaveBeenCalled();
      } finally {
        catalog.resolve({ ok: true, value: { commands: [staticCommand] } });
        await stopFixture(fixture);
      }
    },
  );

  it("falls back promptly when live inspection stalls so the active Turn can be interrupted", async () => {
    const fixture = createFixture();
    const catalog = Promise.withResolvers<HarnessResult<HarnessCommandCatalog>>();
    try {
      Object.assign(fixture.adapter, { commandCatalog: { commands: [staticCommand] } });
      const threadId = await startPiThread(fixture);
      const turnId = await startPiTurn(fixture, threadId);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Fake Pi Session was not opened");
      const list = vi.fn(() => catalog.promise);
      session.commands = { list, execute: async ({ turnId }) => ({ ok: true, value: { turnId } }) };
      writeRequest(fixture.desktopInput, {
        id: 3,
        method: "codexhost/thread/commands/inspect",
        params: { threadId },
      });
      await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
      writeRequest(fixture.desktopInput, {
        id: 4,
        method: "turn/interrupt",
        params: { threadId, turnId },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 3)),
      ).resolves.toMatchObject({ result: { commands: [staticCommand] } });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 4)),
      ).resolves.toMatchObject({ result: {} });
      session.completeCancellation();
    } finally {
      catalog.resolve({ ok: true, value: { commands: [staticCommand, liveSkill] } });
      await stopFixture(fixture);
    }
  });

  it("reports the loaded Session's live catalog", async () => {
    const fixture = createFixture();
    Object.assign(fixture.adapter, { commandCatalog: { commands: [staticCommand] } });
    const threadId = await startPiThread(fixture);
    const session = fixture.adapter.sessions[0];
    if (!session) throw new Error("Fake Pi Session was not opened");
    session.commands = {
      list: async () => ({ ok: true, value: { commands: [staticCommand, liveSkill] } }),
      execute: async ({ turnId }) => ({ ok: true, value: { turnId } }),
    };

    writeRequest(fixture.desktopInput, {
      id: 2,
      method: "codexhost/thread/commands/inspect",
      params: { threadId },
    });
    await expect(
      fixture.collector.waitFor((message) => requestId(message, 2)),
    ).resolves.toMatchObject({ result: { commands: [staticCommand, liveSkill] } });
    await stopFixture(fixture);
  });

  it("falls back to the static catalog when the live listing fails", async () => {
    const fixture = createFixture();
    Object.assign(fixture.adapter, { commandCatalog: { commands: [staticCommand] } });
    const threadId = await startPiThread(fixture);
    const session = fixture.adapter.sessions[0];
    if (!session) throw new Error("Fake Pi Session was not opened");
    const list = vi.fn(async () => ({
      ok: false as const,
      error: { code: "nativeFailure" as const, message: "boom", retryable: true },
    }));
    session.commands = { list, execute: async ({ turnId }) => ({ ok: true, value: { turnId } }) };

    writeRequest(fixture.desktopInput, {
      id: 2,
      method: "codexhost/thread/commands/inspect",
      params: { threadId },
    });
    await expect(
      fixture.collector.waitFor((message) => requestId(message, 2)),
    ).resolves.toMatchObject({ result: { commands: [staticCommand] } });
    expect(list).toHaveBeenCalled();
    await stopFixture(fixture);
  });
});
