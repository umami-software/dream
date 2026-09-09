import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dream-test-user-data" },
}));

const {
  isUsableBaseBranchCandidate,
  parseConflictingFiles,
  parseGitNameStatusZ,
  parseGitNumstatZ,
} = await import("./worktree-completion.js");

test("parses name-status output including renames and copies", () => {
  const output = [
    "A",
    "src/new.ts",
    "M",
    "src/changed.ts",
    "R087",
    "src/old-name.ts",
    "src/new-name.ts",
    "C100",
    "src/source.ts",
    "src/copy.ts",
    "D",
    "src/removed.ts",
    "T",
    "src/typechange.ts",
    "",
  ].join("\0");

  assert.deepEqual(parseGitNameStatusZ(output), [
    { path: "src/new.ts", previousPath: null, status: "added" },
    { path: "src/changed.ts", previousPath: null, status: "modified" },
    {
      path: "src/new-name.ts",
      previousPath: "src/old-name.ts",
      status: "renamed",
    },
    { path: "src/copy.ts", previousPath: "src/source.ts", status: "copied" },
    { path: "src/removed.ts", previousPath: null, status: "deleted" },
    { path: "src/typechange.ts", previousPath: null, status: "modified" },
  ]);
});

test("parses numstat output with binary files and rename pairs", () => {
  const output = [
    "3\t1\tsrc/changed.ts",
    "-\t-\tassets/logo.png",
    "2\t0\t",
    "src/old-name.ts",
    "src/new-name.ts",
    "",
  ].join("\0");

  const stats = parseGitNumstatZ(output);
  assert.deepEqual(stats.get("src/changed.ts"), {
    addedLines: 3,
    removedLines: 1,
  });
  assert.deepEqual(stats.get("assets/logo.png"), {
    addedLines: 0,
    removedLines: 0,
  });
  assert.deepEqual(stats.get("src/new-name.ts"), {
    addedLines: 2,
    removedLines: 0,
  });
  assert.equal(stats.size, 3);
});

test("parses conflicting file lists", () => {
  assert.deepEqual(parseConflictingFiles("a.txt\r\n  src/b.txt\n\n"), [
    "a.txt",
    "src/b.txt",
  ]);
  assert.deepEqual(parseConflictingFiles(""), []);
});

test("rejects unusable base branch candidates", () => {
  assert.equal(isUsableBaseBranchCandidate(null), false);
  assert.equal(isUsableBaseBranchCandidate(""), false);
  assert.equal(isUsableBaseBranchCandidate("   "), false);
  assert.equal(isUsableBaseBranchCandidate("HEAD"), false);
  assert.equal(isUsableBaseBranchCandidate("HEAD abc1234"), false);
  assert.equal(
    isUsableBaseBranchCandidate("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
    false,
  );
  assert.equal(isUsableBaseBranchCandidate("feature", "feature"), false);
  assert.equal(
    isUsableBaseBranchCandidate("refs/heads/feature", "feature"),
    false,
  );
});

test("accepts branch-like base candidates", () => {
  assert.equal(isUsableBaseBranchCandidate("main"), true);
  assert.equal(isUsableBaseBranchCandidate("refs/heads/main", "feature"), true);
  assert.equal(isUsableBaseBranchCandidate("release/1.0", "feature"), true);
});
