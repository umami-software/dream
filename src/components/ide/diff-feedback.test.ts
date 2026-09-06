import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { createProjectConfig, DEFAULT_SETTINGS } from "@/lib/ide-defaults";
import {
  formatDiffReferenceMessage,
  getFirstActiveDiffChatId,
} from "./diff-feedback";

const diff = parsePatchFiles(`diff --git a/old.ts b/new.ts
--- a/old.ts
+++ b/new.ts
@@ -10,3 +10,3 @@
 context
-old value
+new value
 tail
@@ -40,2 +40,2 @@
-other old
+other new
 end
`)[0].files[0];

describe("diff reference messages", () => {
  it("sends the user's question verbatim with neutral selected-line context", () => {
    const question =
      "Why was this value changed?\nPlease explain the reasoning.";
    const text = formatDiffReferenceMessage(
      "new.ts",
      diff,
      { start: 11, end: 11, side: "additions" },
      question,
    );
    expect(text).toBe(
      `${question}\n\nReferenced diff:\nFile: new.ts\nLines: 11-11 (new version)\n\n\`\`\`text\n11: new value\n\`\`\``,
    );
  });
  it("leaves change requests to the user's own words", () => {
    const request = "Replace this with the previous value.";
    const text = formatDiffReferenceMessage(
      "new.ts",
      diff,
      { start: 11, end: 11, side: "deletions" },
      request,
    );
    expect(text).toBe(
      `${request}\n\nReferenced diff:\nFile: new.ts\nLines: 11-11 (old version)\n\n\`\`\`text\n11: old value\n\`\`\``,
    );
  });
  it("maps sparse new-file line numbers and reversed selections", () => {
    const text = formatDiffReferenceMessage(
      "new.ts",
      diff,
      { start: 41, end: 40, side: "additions" },
      "  fix this  ",
      "old.ts",
    );
    expect(text).toContain("Lines: 40-41 (new version)");
    expect(text).toContain("40: other new\n41: end");
    expect(text).toContain("renamed from old.ts");
    expect(text.startsWith("  fix this  \n\nReferenced diff:")).toBe(true);
    expect(text).not.toContain("other old");
  });
  it("uses the old source for deleted lines", () => {
    const text = formatDiffReferenceMessage(
      "new.ts",
      diff,
      { start: 11, end: 11, side: "deletions" },
      "keep this",
    );
    expect(text).toContain("11: old value");
    expect(text).toContain("old version");
    expect(text).not.toContain("new value");
  });
  it.each([
    false,
    true,
  ])("includes old and new lines across sides (reverse: %s)", (reverse) => {
    const text = formatDiffReferenceMessage(
      "a",
      diff,
      reverse
        ? { start: 11, end: 11, side: "additions", endSide: "deletions" }
        : { start: 11, end: 11, side: "deletions", endSide: "additions" },
      "fix",
    );
    expect(text).toContain("- old 11: old value");
    expect(text).toContain("+ new 11: new value");
    expect(text).not.toContain("other old");
    expect(text).toContain("both versions");
  });
  it("maps split selections to aligned rows", () => {
    const text = formatDiffReferenceMessage(
      "a",
      diff,
      { start: 11, end: 11, side: "deletions", endSide: "additions" },
      "fix",
      null,
      "split",
    );
    expect(text).toContain("- old 11: old value");
    expect(text).toContain("+ new 11: new value");
    expect(text).not.toContain("tail");
  });
  it("maps different old and new line numbers using display order", () => {
    const shifted = parsePatchFiles(
      "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -100,2 +200,3 @@\n-old one\n-old two\n+new one\n+new two\n+new three\n",
    )[0].files[0];
    const text = formatDiffReferenceMessage(
      "a",
      shifted,
      { start: 101, end: 201, side: "deletions", endSide: "additions" },
      "fix",
    );
    expect(text).toContain("- old 101: old two");
    expect(text).toContain("+ new 200: new one");
    expect(text).toContain("+ new 201: new two");
    expect(text).not.toContain("old one");
    expect(text).not.toContain("new three");
  });
  it("supports mixed selections across sparse hunks", () => {
    const text = formatDiffReferenceMessage(
      "a",
      diff,
      { start: 11, end: 40, side: "deletions", endSide: "additions" },
      "fix",
    );
    expect(text).toContain("- old 11: old value");
    expect(text).toContain("+ new 11: new value");
    expect(text).toContain("- old 40: other old");
    expect(text).toContain("+ new 40: other new");
    expect(text).not.toContain("41: end");
  });
  it("rejects absent lines", () => {
    expect(() =>
      formatDiffReferenceMessage("a", diff, { start: 30, end: 30 }, "fix"),
    ).toThrow("displayed diff");
  });
  it.each([
    true,
    false,
  ])("supports a wholly added or deleted file (%s)", (added) => {
    const patch = parsePatchFiles(
      `diff --git a/a b/a\n${added ? "new file mode 100644\n--- /dev/null\n+++ b/a\n@@ -0,0 +1,2 @@\n+first\n+```" : "deleted file mode 100644\n--- a/a\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-first\n-```"}\n`,
    )[0].files[0];
    const text = formatDiffReferenceMessage(
      "a",
      patch,
      { start: 1, end: 2, side: added ? "additions" : "deletions" },
      "review",
    );
    expect(text).toContain("1: first\n2: ```");
    expect(text).toContain("````text");
  });
});

describe("first active feedback destination", () => {
  const project = createProjectConfig("/workspace/project", DEFAULT_SETTINGS);
  const chats = [
    { id: "first", projectId: project.id, deletedAt: null },
    { id: "focused", projectId: project.id, deletedAt: null },
    { id: "archived", projectId: project.id, deletedAt: "2026-01-01" },
    { id: "foreign", projectId: "other-project", deletedAt: null },
  ];
  it("uses the first open chat even when another chat has focus", () => {
    const current = {
      ...project,
      ui: {
        ...project.ui,
        openChatIds: ["first", "focused"],
        activeChatId: "focused",
      },
    };
    expect(getFirstActiveDiffChatId(current, chats)).toBe("first");
  });
  it("skips unavailable chats and falls back to the active chat", () => {
    const current = {
      ...project,
      ui: {
        ...project.ui,
        openChatIds: ["archived", "foreign", "missing"],
        activeChatId: "focused",
      },
    };
    expect(getFirstActiveDiffChatId(current, chats)).toBe("focused");
  });
  it("does not pick a closed chat when there is no active chat", () => {
    const current = {
      ...project,
      ui: { ...project.ui, openChatIds: [], activeChatId: null },
    };
    expect(getFirstActiveDiffChatId(current, chats)).toBeNull();
  });
});
