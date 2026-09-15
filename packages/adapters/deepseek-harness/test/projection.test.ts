import { expect, it } from "vitest";
import { structuredDiffs } from "../src/projection.js";

it("preserves separate same-path fragments without pretending they have file coordinates", () => {
  const changes =
    structuredDiffs({
      diffs: [
        { path: "a.txt", oldText: "first old\n", newText: "first new\n" },
        { path: "a.txt", oldText: "last old\n", newText: "last new\n" },
      ],
    }) ?? [];
  expect(changes).toHaveLength(2);
  expect(changes.every((change) => change.diffScope === "fragment")).toBe(true);
  expect(changes[0]?.unifiedDiff).toContain("-first old");
  expect(changes[0]?.unifiedDiff).toContain("+first new");
  expect(changes[1]?.unifiedDiff).toContain("-last old");
  expect(changes[1]?.unifiedDiff).toContain("+last new");
});
