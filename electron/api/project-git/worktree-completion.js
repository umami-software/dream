import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getPullRequestBaseRef,
  readGitCommitCount,
  readGitPushPreviewCommits,
} from "./actions.js";
import {
  getGitAheadBehindCounts,
  getGitCommandErrorMessage,
  getGitRepositoryInfo,
  getProjectGitMetadata,
  gitRefExists,
  listProjectGitChanges,
  listProjectGitWorktrees,
  parseSingleFileDiff,
  runGhCommand,
  runGitCommand,
} from "./core.js";
import { normalizePath, resolveProjectPath } from "./files.js";

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const mapNameStatusCode = (code) => {
  switch (code?.[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
};

export const parseGitNameStatusZ = (output) => {
  const tokens = (output ?? "").split("\0");
  const entries = [];

  for (let index = 0; index < tokens.length; index++) {
    const code = tokens[index];
    if (!code) {
      continue;
    }

    const status = mapNameStatusCode(code);
    if (status === "renamed" || status === "copied") {
      const previousPath = tokens[index + 1] ?? "";
      const currentPath = tokens[index + 2] ?? "";
      index += 2;
      if (!currentPath) {
        continue;
      }
      entries.push({
        path: normalizePath(currentPath),
        previousPath: previousPath ? normalizePath(previousPath) : null,
        status,
      });
      continue;
    }

    const currentPath = tokens[index + 1] ?? "";
    index += 1;
    if (!currentPath) {
      continue;
    }
    entries.push({
      path: normalizePath(currentPath),
      previousPath: null,
      status,
    });
  }

  return entries;
};

const parseNumstatCount = (value) => {
  if (value === "-") {
    return 0;
  }
  return Number.parseInt(value, 10) || 0;
};

export const parseGitNumstatZ = (output) => {
  const tokens = (output ?? "").split("\0");
  const stats = new Map();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    const [added = "0", removed = "0", inlinePath = ""] = token.split("\t");
    const entry = {
      addedLines: parseNumstatCount(added),
      removedLines: parseNumstatCount(removed),
    };

    if (inlinePath) {
      stats.set(normalizePath(inlinePath), entry);
      continue;
    }

    // Rename/copy entries are emitted as "added\tremoved\t\0old\0new\0".
    const currentPath = tokens[index + 2] ?? "";
    index += 2;
    if (currentPath) {
      stats.set(normalizePath(currentPath), entry);
    }
  }

  return stats;
};

export const parseConflictingFiles = (output) =>
  (output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath);

export const isUsableBaseBranchCandidate = (baseRef, worktreeBranch = null) => {
  if (typeof baseRef !== "string") {
    return false;
  }

  const trimmed = baseRef.trim();
  if (!trimmed || trimmed === "HEAD" || /^HEAD\s/.test(trimmed)) {
    return false;
  }

  if (FULL_SHA_PATTERN.test(trimmed)) {
    return false;
  }

  const normalized = trimmed.replace(/^refs\/heads\//, "");
  if (worktreeBranch && normalized === worktreeBranch) {
    return false;
  }

  return true;
};

const isDetachedBranch = (branch) => !branch || branch.startsWith("HEAD ");

const resolveWorktreeContext = async (projectPath) => {
  const repoInfo = await getGitRepositoryInfo(projectPath);
  if (!repoInfo.isRepo || !repoInfo.repoRoot) {
    throw new Error("Project is not a Git repository.");
  }

  if (isDetachedBranch(repoInfo.branch)) {
    throw new Error("Cannot complete a detached worktree.");
  }

  const worktreePath = path.resolve(projectPath);
  const worktreesInfo = await listProjectGitWorktrees(projectPath);
  const entry = worktreesInfo.worktrees.find(
    (worktree) => path.resolve(worktree.path) === worktreePath,
  );
  const mainWorktreePath = worktreesInfo.mainWorktreePath
    ? path.resolve(worktreesInfo.mainWorktreePath)
    : null;

  if (!entry || !mainWorktreePath || mainWorktreePath === worktreePath) {
    throw new Error("Project is not a linked worktree.");
  }

  return {
    mainWorktreePath,
    worktreeBranch: repoInfo.branch,
    worktreePath,
    worktreeRoot: repoInfo.repoRoot,
  };
};

export const resolveWorktreeBaseBranch = async (
  mainWorktreePath,
  { baseRef = null, worktreeBranch = null } = {},
) => {
  const metadata = await getProjectGitMetadata(mainWorktreePath, null);
  const candidate = isUsableBaseBranchCandidate(baseRef, worktreeBranch)
    ? baseRef.trim().replace(/^refs\/heads\//, "")
    : metadata.baseBranch;

  if (!candidate) {
    throw new Error("Unable to determine the base branch for this worktree.");
  }

  const baseExistsLocally = await gitRefExists(
    mainWorktreePath,
    `refs/heads/${candidate}`,
  );
  const compareRef = baseExistsLocally
    ? candidate
    : await getPullRequestBaseRef(
        mainWorktreePath,
        metadata.remoteName,
        candidate,
      );

  if (!compareRef) {
    throw new Error(`Base branch "${candidate}" was not found.`);
  }

  return {
    baseBranch: candidate,
    baseExistsLocally,
    compareRef,
    remoteName: metadata.remoteName,
  };
};

const readMergeBase = async (cwd, compareRef) => {
  const result = await runGitCommand(cwd, ["merge-base", compareRef, "HEAD"], {
    allowFailure: true,
  });
  return result.ok ? result.stdout.trim() || null : null;
};

const readCurrentBranch = async (cwd) => {
  const result = await runGitCommand(cwd, ["branch", "--show-current"], {
    allowFailure: true,
  });
  return result.ok ? result.stdout.trim() || null : null;
};

const readTrackedDirtyCount = async (cwd) => {
  const result = await runGitCommand(cwd, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  return result.stdout.split(/\r?\n/).filter((line) => line.trim()).length;
};

const hasGitRef = async (cwd, ref) => {
  const result = await runGitCommand(
    cwd,
    ["rev-parse", "-q", "--verify", ref],
    {
      allowFailure: true,
    },
  );
  return result.ok;
};

const hasInProgressOperation = async (cwd) =>
  (await hasGitRef(cwd, "MERGE_HEAD")) || (await hasGitRef(cwd, "REBASE_HEAD"));

const readCompareFiles = async (worktreeRoot, mergeBase) => {
  const [nameStatusResult, numstatResult] = await Promise.all([
    runGitCommand(worktreeRoot, [
      "diff",
      "--name-status",
      "--find-renames",
      "--no-ext-diff",
      "-z",
      mergeBase,
      "HEAD",
    ]),
    runGitCommand(worktreeRoot, [
      "diff",
      "--numstat",
      "--find-renames",
      "--no-ext-diff",
      "-z",
      mergeBase,
      "HEAD",
    ]),
  ]);
  const stats = parseGitNumstatZ(numstatResult.stdout);

  return parseGitNameStatusZ(nameStatusResult.stdout)
    .map((entry) => {
      const entryStats = stats.get(entry.path) ?? {
        addedLines: 0,
        removedLines: 0,
      };
      return {
        ...entry,
        addedLines: entryStats.addedLines,
        removedLines: entryStats.removedLines,
        staged: false,
        unstaged: false,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
};

export const compareProjectGitWorktree = async (
  projectPath,
  { baseRef = null } = {},
) => {
  const context = await resolveWorktreeContext(projectPath);
  const base = await resolveWorktreeBaseBranch(context.mainWorktreePath, {
    baseRef,
    worktreeBranch: context.worktreeBranch,
  });
  const rangeRef = `${base.compareRef}..HEAD`;

  const [
    mergeBase,
    counts,
    commits,
    totalCommits,
    worktreeStatus,
    worktreeMetadata,
    mainBranch,
    mainDirtyCount,
    mainInProgressOperation,
    ghResult,
  ] = await Promise.all([
    readMergeBase(context.worktreeRoot, base.compareRef),
    getGitAheadBehindCounts(context.worktreeRoot, base.compareRef),
    readGitPushPreviewCommits(context.worktreeRoot, rangeRef),
    readGitCommitCount(context.worktreeRoot, rangeRef),
    listProjectGitChanges(projectPath),
    getProjectGitMetadata(context.worktreeRoot, context.worktreeBranch),
    readCurrentBranch(context.mainWorktreePath),
    readTrackedDirtyCount(context.mainWorktreePath),
    hasInProgressOperation(context.mainWorktreePath),
    runGhCommand(context.mainWorktreePath, ["--version"], {
      allowFailure: true,
    }),
  ]);
  const files = mergeBase
    ? await readCompareFiles(context.worktreeRoot, mergeBase)
    : [];

  return {
    aheadCount: counts.aheadCount,
    baseBranch: base.baseBranch,
    baseExistsLocally: base.baseExistsLocally,
    behindCount: counts.behindCount,
    branch: context.worktreeBranch,
    commits,
    compareRef: base.compareRef,
    files,
    ghAvailable: ghResult.ok,
    mainBranch,
    mainClean: mainDirtyCount === 0,
    mainDirtyCount,
    mainInProgressOperation,
    mainWorktreePath: context.mainWorktreePath,
    mergeBase,
    remoteName: base.remoteName,
    totalCommits,
    truncated: commits.length < totalCommits,
    upstreamBranch: worktreeMetadata.upstreamBranch,
    worktreePath: context.worktreePath,
    worktreeStatus,
  };
};

export const getProjectGitWorktreeCompareDiff = async (
  projectPath,
  { baseRef = null, filePath, previousPath = null, status },
) => {
  const context = await resolveWorktreeContext(projectPath);
  const base = await resolveWorktreeBaseBranch(context.mainWorktreePath, {
    baseRef,
    worktreeBranch: context.worktreeBranch,
  });
  const mergeBase = await readMergeBase(context.worktreeRoot, base.compareRef);
  if (!mergeBase) {
    throw new Error("No common ancestor with the base branch.");
  }

  const normalizedFilePath = normalizePath(filePath);
  const toRepoRelative = (value) =>
    normalizePath(
      path.relative(
        context.worktreeRoot,
        resolveProjectPath(projectPath, normalizePath(value)),
      ),
    );
  const pathspec = [toRepoRelative(normalizedFilePath)];
  if (previousPath) {
    pathspec.push(toRepoRelative(previousPath));
  }

  const diffResult = await runGitCommand(context.worktreeRoot, [
    "diff",
    "--find-renames",
    "--no-ext-diff",
    "--submodule=diff",
    mergeBase,
    "HEAD",
    "--",
    ...pathspec,
  ]);

  return {
    branch: context.worktreeBranch,
    diff: diffResult.stdout,
    filePath: normalizedFilePath,
    parsedDiff: parseSingleFileDiff(diffResult.stdout),
    previousPath,
    status,
  };
};

export const mergeProjectGitWorktree = async (
  projectPath,
  { acknowledgeUncommitted = false, baseRef = null } = {},
) => {
  const context = await resolveWorktreeContext(projectPath);
  const base = await resolveWorktreeBaseBranch(context.mainWorktreePath, {
    baseRef,
    worktreeBranch: context.worktreeBranch,
  });

  if (
    !acknowledgeUncommitted &&
    (await readTrackedDirtyCount(context.worktreeRoot)) > 0
  ) {
    throw new Error(
      "The worktree has uncommitted changes. Commit them or choose to discard them first.",
    );
  }

  if (await hasInProgressOperation(context.mainWorktreePath)) {
    throw new Error("The main worktree has a merge or rebase in progress.");
  }

  const previousMainBranch = await readCurrentBranch(context.mainWorktreePath);
  if ((await readTrackedDirtyCount(context.mainWorktreePath)) > 0) {
    throw new Error(
      `The main worktree has uncommitted changes on ${
        previousMainBranch ?? "its current branch"
      }. Commit or stash them before merging.`,
    );
  }

  const counts = await getGitAheadBehindCounts(
    context.worktreeRoot,
    base.compareRef,
  );
  if (counts.aheadCount === 0) {
    throw new Error(
      `${context.worktreeBranch} has no commits to merge into ${base.baseBranch}.`,
    );
  }

  if (previousMainBranch !== base.baseBranch) {
    await runGitCommand(context.mainWorktreePath, [
      "checkout",
      base.baseBranch,
    ]);
  }

  const branchHeadResult = await runGitCommand(context.mainWorktreePath, [
    "rev-parse",
    `refs/heads/${context.worktreeBranch}`,
  ]);
  const branchHead = branchHeadResult.stdout.trim();

  const mergeResult = await runGitCommand(
    context.mainWorktreePath,
    ["merge", "--no-edit", context.worktreeBranch],
    { allowFailure: true },
  );

  if (!mergeResult.ok) {
    if (await hasGitRef(context.mainWorktreePath, "MERGE_HEAD")) {
      const conflictsResult = await runGitCommand(
        context.mainWorktreePath,
        ["diff", "--name-only", "--diff-filter=U"],
        { allowFailure: true },
      );
      await runGitCommand(context.mainWorktreePath, ["merge", "--abort"], {
        allowFailure: true,
      });

      return {
        baseBranch: base.baseBranch,
        branch: context.worktreeBranch,
        conflictingFiles: parseConflictingFiles(conflictsResult.stdout),
        mainWorktreePath: context.mainWorktreePath,
        previousMainBranch,
        status: "conflict",
      };
    }

    throw new Error(getGitCommandErrorMessage(mergeResult.error));
  }

  const afterHeadResult = await runGitCommand(context.mainWorktreePath, [
    "rev-parse",
    "HEAD",
  ]);
  const mergeCommit = afterHeadResult.stdout.trim();

  return {
    baseBranch: base.baseBranch,
    branch: context.worktreeBranch,
    fastForward: mergeCommit === branchHead,
    mainWorktreePath: context.mainWorktreePath,
    mergeCommit,
    previousMainBranch,
    status: "merged",
  };
};

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const cleanupProjectGitWorktree = async (
  projectPath,
  { deleteBranch = false, force = false, worktreePath = "" } = {},
) => {
  const repoInfo = await getGitRepositoryInfo(projectPath);
  if (!repoInfo.isRepo || !repoInfo.repoRoot) {
    throw new Error("Project is not a Git repository.");
  }

  const targetPath = path.resolve(worktreePath);
  const worktreesInfo = await listProjectGitWorktrees(projectPath);
  const entry = worktreesInfo.worktrees.find(
    (worktree) => path.resolve(worktree.path) === targetPath,
  );
  if (!entry) {
    throw new Error("Worktree was not found for this repository.");
  }

  if (
    worktreesInfo.mainWorktreePath &&
    path.resolve(worktreesInfo.mainWorktreePath) === targetPath
  ) {
    throw new Error("Cannot remove the main worktree.");
  }

  const commandCwd = worktreesInfo.mainWorktreePath ?? repoInfo.repoRoot;
  const branch = entry.branch ?? null;
  let pruned = false;

  const removeResult = await runGitCommand(
    commandCwd,
    ["worktree", "remove", ...(force ? ["--force"] : []), targetPath],
    { allowFailure: true },
  );

  if (!removeResult.ok) {
    if (await pathExists(targetPath)) {
      throw new Error(getGitCommandErrorMessage(removeResult.error));
    }

    await runGitCommand(commandCwd, ["worktree", "prune"]);
    pruned = true;
  }

  let branchDeleted = false;
  let branchDeleteError = null;

  if (deleteBranch && branch) {
    const deleteResult = await runGitCommand(
      commandCwd,
      ["branch", "-d", branch],
      { allowFailure: true },
    );
    branchDeleted = deleteResult.ok;
    if (!deleteResult.ok) {
      branchDeleteError = getGitCommandErrorMessage(deleteResult.error);
    }
  }

  return {
    branch,
    branchDeleted,
    branchDeleteError,
    path: targetPath,
    pruned,
    removed: true,
  };
};
