import { describe, expect, it, vi } from "vitest";
import {
  decodeHarnessPluginRoute,
  harnessModelRefSchema,
  harnessPermissionModeIdSchema,
  harnessThinkingOptionIdSchema,
} from "@codexhost/shared-contracts";
import { DraftAgentController, DEFAULT_RENDERER_AGENTS } from "../src/agent-selection-state.js";
import { RENDERER_AGENT_LABELS } from "../src/renderer-agent-icon.js";
import { modelSelectionForAgent } from "../src/versioned-renderer-adapter.js";
import { restoredThreadOwnership } from "../src/renderer-binding-probe.js";

describe("ZCode Desktop selection", () => {
  it("round trips configuration and locked Thread restoration through the shared plugin route", async () => {
    expect(DEFAULT_RENDERER_AGENTS).toContain("zcode");
    expect(RENDERER_AGENT_LABELS.zcode).toBe("ZCode");
    const model = harnessModelRefSchema.parse({ id: "zcode-v1.WyJwIiwibSJd" });
    const thinking = harnessThinkingOptionIdSchema.parse("high"),
      permission = harnessPermissionModeIdSchema.parse("build");
    const selection = modelSelectionForAgent(null, null, "zcode", model, thinking, permission);
    if (!selection || typeof selection.model !== "string") throw new Error("Missing plugin route");
    expect(decodeHarnessPluginRoute(selection.model)).toEqual({
      harnessId: "zcode",
      model,
      thinkingOptionId: thinking,
      permissionModeId: permission,
    });
    expect(
      restoredThreadOwnership({
        owner: "external",
        harnessId: "zcode",
        transportModelId: selection.model,
        locked: true,
        history: { fork: true, forkAcrossCwd: false, rollbackLastTurn: true },
      }),
    ).toEqual({ agent: "zcode", model, thinkingOptionId: thinking, permissionModeId: permission });
    const controller = new DraftAgentController(),
      composer = {};
    controller.mount(composer, ["default"]);
    controller.setExternalModel(composer, "zcode", model);
    controller.setExternalThinkingOption(composer, "zcode", thinking);
    controller.setExternalPermissionMode(composer, "zcode", permission);
    const operations = {
      applyAgent: vi.fn(() => true),
      clearPrewarm: vi.fn(async () => undefined),
    };
    for (const agent of ["zcode", "codex", "zcode"] as const)
      await controller.switchAgent(composer, agent, operations);
    expect(controller.modelForAgent(composer, "zcode")).toEqual(model);
    expect(controller.thinkingOptionForAgent(composer, "zcode")).toBe(thinking);
    expect(controller.permissionModeForAgent(composer, "zcode")).toBe(permission);
    controller.restore(composer, "zcode");
    expect(controller.modelForAgent(composer, "zcode")).toBeUndefined();
    expect(controller.thinkingOptionForAgent(composer, "zcode")).toBeUndefined();
    expect(controller.permissionModeForAgent(composer, "zcode")).toBeUndefined();
  });
});
