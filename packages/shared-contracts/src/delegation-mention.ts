/**
 * Delegation mention carrier shared by the Renderer `#` picker and the Host.
 *
 * The Renderer inserts Codex Desktop's native `agentMention` node, which
 * Desktop serializes into the prompt as a Markdown link. `subagent://` is the
 * scheme Desktop already restores and renders as an agent chip; the
 * `codexhost.` prefix keeps these targets apart from native custom agent
 * roles. The Host must rewrite every carrier before the prompt reaches a
 * Harness, so the raw link never leaks into a model turn.
 */
export const DELEGATION_MENTION_PATH_PREFIX = "subagent://codexhost.";

const HARNESS_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const MENTION_LINK_PATTERN =
  /\[@([^\]\n]+)\]\(<?subagent:\/\/codexhost\.([a-z0-9][a-z0-9-]*)>?\)/gu;

export interface DelegationMention {
  harnessId: string;
  label: string;
}

export function delegationMentionPath(harnessId: string): string {
  if (!HARNESS_ID_PATTERN.test(harnessId)) {
    throw new Error(`Invalid delegation mention Harness id: ${harnessId}`);
  }
  return `${DELEGATION_MENTION_PATH_PREFIX}${harnessId}`;
}

function sanitizeLabel(label: string): string {
  const cleaned = label
    .replace(/[[\]()\n\r]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "agent";
}

/** Markdown carrier Desktop restores into a native agent mention chip. */
export function formatDelegationMentionLink(mention: DelegationMention): string {
  return `[@${sanitizeLabel(mention.label)}](${delegationMentionPath(mention.harnessId)})`;
}

export interface DelegationMentionRewrite {
  text: string;
  mentions: DelegationMention[];
}

/**
 * Replace each carrier link with its readable `@Label` form. Returns the
 * mentioned targets in first-seen order, without duplicates.
 */
export function stripDelegationMentions(text: string): DelegationMentionRewrite {
  const mentions: DelegationMention[] = [];
  const seen = new Set<string>();
  const rewritten = text.replace(
    MENTION_LINK_PATTERN,
    (_match, label: string, harnessId: string) => {
      const trimmed = label.trim();
      if (!seen.has(harnessId)) {
        seen.add(harnessId);
        mentions.push({ harnessId, label: trimmed });
      }
      return `@${trimmed}`;
    },
  );
  return { text: rewritten, mentions };
}
