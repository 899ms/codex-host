import type { HarnessSessionCapabilities } from "@codexhost/harness-adapter";
export const CAPABILITIES: HarnessSessionCapabilities = {
  configuration: {
    selectModel: true,
    selectThinkingOption: true,
    selectPermissionMode: true,
    permissionModeScope: "live",
  },
  history: { fork: true, forkAcrossCwd: false, rollbackLastTurn: true },
  subagents: { observe: true, readTranscript: true },
  autonomousTurns: { observe: true },
};
