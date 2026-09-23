import { describe, expect, it } from "vitest";

import {
  delegationMentionPath,
  formatDelegationMentionLink,
  stripDelegationMentions,
} from "../src/index.js";

describe("delegation mention carrier", () => {
  it("formats a Desktop-restorable agent mention link", () => {
    expect(formatDelegationMentionLink({ harnessId: "claude-code", label: "Claude Code" })).toBe(
      "[@Claude Code](subagent://codexhost.claude-code)",
    );
    expect(
      formatDelegationMentionLink({ harnessId: "cursor-cli", label: "Cursor CLI (Experimental)" }),
    ).toBe("[@Cursor CLI Experimental](subagent://codexhost.cursor-cli)");
  });

  it("rejects Harness ids that would break the carrier", () => {
    expect(() => delegationMentionPath("bad id")).toThrow();
    expect(() => delegationMentionPath("../x")).toThrow();
  });

  it("strips carriers into readable mentions without duplicates", () => {
    const result = stripDelegationMentions(
      "[@Claude Code](subagent://codexhost.claude-code) review, then [@Grok](subagent://codexhost.grok) and [@Claude Code](subagent://codexhost.claude-code)",
    );
    expect(result.text).toBe("@Claude Code review, then @Grok and @Claude Code");
    expect(result.mentions).toEqual([
      { harnessId: "claude-code", label: "Claude Code" },
      { harnessId: "grok", label: "Grok" },
    ]);
  });

  it("leaves native custom agent roles and plain text alone", () => {
    const text = "[@reviewer](subagent://reviewer) and #claude";
    expect(stripDelegationMentions(text)).toEqual({ text, mentions: [] });
  });
});
