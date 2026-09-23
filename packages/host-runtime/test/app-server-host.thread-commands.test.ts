import { describe, expect, it, vi } from "vitest";
import { harnessCommandDescriptorSchema } from "@codexhost/shared-contracts";

import {
  createFixture,
  requestId,
  startPiThread,
  stopFixture,
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
