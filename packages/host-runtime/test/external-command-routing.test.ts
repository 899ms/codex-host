import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessResult, HarnessSession } from "@codexhost/harness-adapter";
import type { HarnessCommandCatalog } from "@codexhost/shared-contracts";

import { inspectLiveCommandCatalog } from "../src/external-command-routing.js";

afterEach(() => vi.useRealTimers());

describe("bounded live command inspection", () => {
  it.each(["success", "failure", "throw"])("clears its timer after %s", async (outcome) => {
    vi.useFakeTimers();
    const commands: NonNullable<HarnessSession["commands"]> = {
      list: async () => {
        if (outcome === "throw") throw new Error("offline");
        return outcome === "success"
          ? { ok: true, value: { commands: [] } }
          : { ok: false, error: { code: "unavailable", message: "offline", retryable: true } };
      },
      execute: async ({ turnId }) => ({ ok: true, value: { turnId } }),
    };
    await expect(inspectLiveCommandCatalog(commands)).resolves.toEqual(
      outcome === "success" ? { commands: [] } : null,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late rejection after falling back at the inspection deadline", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<HarnessResult<HarnessCommandCatalog>>();
    const commands: NonNullable<HarnessSession["commands"]> = {
      list: () => pending.promise,
      execute: async ({ turnId }) => ({ ok: true, value: { turnId } }),
    };
    const result = inspectLiveCommandCatalog(commands, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBeNull();
    pending.reject(new Error("late native failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
