/**
 * Change checkpoints.
 *
 * Every agent turn captures the project's working tree before it starts and
 * after it finishes.  Snapshots are stored as git trees inside a per-project
 * "shadow" repository that lives under Dream's userData folder, so the feature
 * works for git and non-git projects alike and never touches the user's own
 * repository.  Trees are pinned by refs (`refs/dream/<chat>/<checkpoint>/…`) so
 * garbage collection never prunes them.
 */

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { parseSingleFileDiff } from "../project-git/core.js";
import { normalizePath, resolveProjectPath } from "../project-git/files.js";

const execFileAsync = promisify(execFile);

const GIT_EXEC_MAX_BUFFER = 64 * 1024 * 1024;
const REF_NAMESPACE = "refs/dream";
const GC_AUTO_INTERVAL = 25;

const SHADOW_EXCLUDES = [
  "# Managed by Dream. Paths listed here are never captured in checkpoints.",
  ".DS_Store",
  "*.log",
  ".cache/",
  ".next/",
  ".nuxt/",
  ".output/",
  ".parcel-cache/",
  ".pnpm-store/",
  ".turbo/",
  ".venv/",
  ".vite/",
  "__pycache__/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "out/",
  "release/",
  "target/",
  "venv/",
];

const SHADOW_CONFIG = [
  ["core.bare", "false"],
  ["core.autocrlf", "false"],
  ["core.safecrlf", "false"],
  ["core.longpaths", "true"],
  ["core.filemode", "false"],
  ["core.untrackedCache", "true"],
  ["core.preloadIndex", "true"],
  ["core.quotepath", "false"],
  ["gc.auto", "0"],
];

const ensuredShadowRepositories = new Set();
const projectLocks = new Map();
let finalizeCount = 0;

export class CheckpointNotFoundError extends Error {
  constructor(message = "Checkpoint not found.") {
    super(message);
    this.name = "CheckpointNotFoundError";
  }
}

const getProjectKey = (projectPath) => {
  const resolved = normalizePath(path.resolve(projectPath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const getCheckpointsDirectory = () =>
  path.join(app.getPath("userData"), "checkpoints");

export const getShadowRepoDirectory = (projectPath) =>
  path.join(
    getCheckpointsDirectory(),
    createHash("sha1").update(getProjectKey(projectPath)).digest("hex"),
  );

const getGitErrorMessage = (error) => {
  if (error?.code === "ENOENT") {
    return "Git is not available on PATH.";
  }

  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  return stderr || stdout || error?.message || "Git command failed.";
};

const runShadowGit = async (
  projectPath,
  args,
  { allowFailure = false, encoding = "utf8" } = {},
) => {
  const shadowDir = getShadowRepoDirectory(projectPath);
  try {
    const result = await execFileAsync(
      "git",
      ["--git-dir", shadowDir, "--work-tree", projectPath, ...args],
      {
        cwd: projectPath,
        encoding,
        maxBuffer: GIT_EXEC_MAX_BUFFER,
        windowsHide: true,
      },
    );
    return { ok: true, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    if (allowFailure) {
      return {
        error,
        ok: false,
        stderr: error?.stderr ?? "",
        stdout: error?.stdout ?? "",
      };
    }
    throw new Error(getGitErrorMessage(error));
  }
};

const runShadowGitWithInput = (projectPath, args, input) =>
  new Promise((resolve) => {
    const shadowDir = getShadowRepoDirectory(projectPath);
    const child = spawn(
      "git",
      ["--git-dir", shadowDir, "--work-tree", projectPath, ...args],
      { cwd: projectPath, windowsHide: true },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        stderr: getGitErrorMessage(error),
        stdout: "",
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });

export const withProjectCheckpointLock = (projectPath, task) => {
  const key = getProjectKey(projectPath);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  projectLocks.set(key, run);
  const release = () => {
    if (projectLocks.get(key) === run) {
      projectLocks.delete(key);
    }
  };
  run.then(release, release);
  return run;
};

const sanitizeRefSegment = (value) => {
  const sanitized = String(value ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.lock$/i, "_lock");
  if (!sanitized || sanitized.includes("..")) {
    throw new Error("Invalid checkpoint identifier.");
  }
  return sanitized;
};

const getCheckpointRefPrefix = (chatId, checkpointId) =>
  `${REF_NAMESPACE}/${sanitizeRefSegment(chatId)}/${sanitizeRefSegment(checkpointId)}`;

export const ensureShadowRepository = async (projectPath) => {
  const shadowDir = getShadowRepoDirectory(projectPath);
  if (ensuredShadowRepositories.has(shadowDir)) {
    return shadowDir;
  }

  let initialized = false;
  try {
    await fs.access(path.join(shadowDir, "HEAD"));
    initialized = true;
  } catch {
    initialized = false;
  }

  if (!initialized) {
    await fs.mkdir(path.dirname(shadowDir), { recursive: true });
    try {
      await execFileAsync("git", ["init", "-q", "--bare", shadowDir], {
        windowsHide: true,
      });
    } catch (error) {
      throw new Error(getGitErrorMessage(error));
    }
  }

  for (const [key, value] of SHADOW_CONFIG) {
    try {
      await execFileAsync(
        "git",
        ["--git-dir", shadowDir, "config", "--local", key, value],
        { windowsHide: true },
      );
    } catch (error) {
      throw new Error(getGitErrorMessage(error));
    }
  }

  await fs.mkdir(path.join(shadowDir, "info"), { recursive: true });
  await fs.writeFile(
    path.join(shadowDir, "info", "exclude"),
    `${SHADOW_EXCLUDES.join("\n")}\n`,
    "utf8",
  );

  ensuredShadowRepositories.add(shadowDir);
  return shadowDir;
};

const snapshotWorkingTreeUnlocked = async (projectPath) => {
  await ensureShadowRepository(projectPath);
  await runShadowGit(projectPath, ["add", "-A", "--ignore-errors"]);
  const result = await runShadowGit(projectPath, ["write-tree"]);
  const tree = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) {
    throw new Error("Failed to capture the project snapshot.");
  }
  return tree;
};

export const snapshotWorkingTree = (projectPath) =>
  withProjectCheckpointLock(projectPath, () =>
    snapshotWorkingTreeUnlocked(projectPath),
  );

const readRef = async (projectPath, ref) => {
  const result = await runShadowGit(
    projectPath,
    ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`],
    { allowFailure: true },
  );
  if (!result.ok) {
    return null;
  }
  const tree = result.stdout.trim();
  return tree || null;
};

const writeRef = (projectPath, ref, tree) =>
  runShadowGit(projectPath, ["update-ref", ref, tree]);

export const createCheckpoint = ({ chatId, projectPath }) =>
  withProjectCheckpointLock(projectPath, async () => {
    const checkpointId = randomUUID();
    const beforeTree = await snapshotWorkingTreeUnlocked(projectPath);
    await writeRef(
      projectPath,
      `${getCheckpointRefPrefix(chatId, checkpointId)}/before`,
      beforeTree,
    );
    return { beforeTree, checkpointId };
  });

const finalizeCheckpointUnlocked = async ({
  chatId,
  checkpointId,
  projectPath,
}) => {
  const afterTree = await snapshotWorkingTreeUnlocked(projectPath);
  await writeRef(
    projectPath,
    `${getCheckpointRefPrefix(chatId, checkpointId)}/after`,
    afterTree,
  );
  finalizeCount += 1;
  if (finalizeCount % GC_AUTO_INTERVAL === 0) {
    await runShadowGit(
      projectPath,
      ["-c", "gc.auto=6700", "gc", "--auto", "--quiet"],
      { allowFailure: true },
    );
  }
  return afterTree;
};

export const finalizeCheckpoint = ({ chatId, checkpointId, projectPath }) =>
  withProjectCheckpointLock(projectPath, () =>
    finalizeCheckpointUnlocked({ chatId, checkpointId, projectPath }),
  );

const loadCheckpointTrees = async ({ chatId, checkpointId, projectPath }) => {
  await ensureShadowRepository(projectPath);
  const prefix = getCheckpointRefPrefix(chatId, checkpointId);
  const beforeTree = await readRef(projectPath, `${prefix}/before`);
  if (!beforeTree) {
    throw new CheckpointNotFoundError();
  }

  let afterTree = await readRef(projectPath, `${prefix}/after`);
  let complete = true;
  if (!afterTree) {
    afterTree = await finalizeCheckpointUnlocked({
      chatId,
      checkpointId,
      projectPath,
    });
    complete = false;
  }

  return { afterTree, beforeTree, complete };
};

const mapChangeStatus = (code) => {
  switch (code[0]) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
};

const parseNameStatus = (output) => {
  const tokens = output.split("\0");
  const entries = [];
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index];
    if (!code) {
      index += 1;
      continue;
    }
    if (code.startsWith("R") || code.startsWith("C")) {
      const previousPath = tokens[index + 1] ?? "";
      const filePath = tokens[index + 2] ?? "";
      if (filePath) {
        entries.push({
          filePath,
          previousPath: previousPath || null,
          status: mapChangeStatus(code),
        });
      }
      index += 3;
      continue;
    }
    const filePath = tokens[index + 1] ?? "";
    if (filePath) {
      entries.push({
        filePath,
        previousPath: null,
        status: mapChangeStatus(code),
      });
    }
    index += 2;
  }
  return entries;
};

const parseNumstat = (output) => {
  const tokens = output.split("\0");
  const stats = new Map();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      index += 1;
      continue;
    }
    const [added, deleted, inlinePath] = token.split("\t");
    let filePath = inlinePath ?? "";
    if (!filePath) {
      filePath = tokens[index + 2] ?? "";
      index += 3;
    } else {
      index += 1;
    }
    if (!filePath) {
      continue;
    }
    const binary = added === "-" || deleted === "-";
    stats.set(filePath, {
      additions: binary ? 0 : Number.parseInt(added, 10) || 0,
      binary,
      deletions: binary ? 0 : Number.parseInt(deleted, 10) || 0,
    });
  }
  return stats;
};

const listTreeChanges = async (
  projectPath,
  fromTree,
  toTree,
  pathspecs = [],
) => {
  const pathArgs = pathspecs.length > 0 ? ["--", ...pathspecs] : [];
  const nameStatus = await runShadowGit(projectPath, [
    "diff-tree",
    "-r",
    "-M",
    "--name-status",
    "-z",
    fromTree,
    toTree,
    ...pathArgs,
  ]);
  const numstat = await runShadowGit(projectPath, [
    "diff-tree",
    "-r",
    "-M",
    "--numstat",
    "-z",
    fromTree,
    toTree,
    ...pathArgs,
  ]);
  const stats = parseNumstat(numstat.stdout);
  return parseNameStatus(nameStatus.stdout).map((entry) => ({
    ...entry,
    ...(stats.get(entry.filePath) ?? {
      additions: 0,
      binary: false,
      deletions: 0,
    }),
  }));
};

export const listCheckpointChanges = ({ chatId, checkpointId, projectPath }) =>
  withProjectCheckpointLock(projectPath, async () => {
    const { afterTree, beforeTree, complete } = await loadCheckpointTrees({
      chatId,
      checkpointId,
      projectPath,
    });
    const changes = await listTreeChanges(projectPath, beforeTree, afterTree);
    if (changes.length === 0) {
      return { complete, files: [] };
    }

    const currentTree = await snapshotWorkingTreeUnlocked(projectPath);
    const modifiedSincePaths = new Set();
    if (currentTree !== afterTree) {
      const result = await runShadowGit(projectPath, [
        "diff-tree",
        "-r",
        "--name-only",
        "-z",
        afterTree,
        currentTree,
      ]);
      for (const entry of result.stdout.split("\0")) {
        if (entry) {
          modifiedSincePaths.add(entry);
        }
      }
    }

    return {
      complete,
      files: changes.map((change) => ({
        ...change,
        modifiedSince:
          modifiedSincePaths.has(change.filePath) ||
          (change.previousPath !== null &&
            modifiedSincePaths.has(change.previousPath)),
      })),
    };
  });

const normalizeRequestPath = (projectPath, filePath) => {
  const normalized = normalizePath(filePath).replace(/^\.\//, "");
  resolveProjectPath(projectPath, normalized);
  if (!normalized || normalized === "." || path.isAbsolute(normalized)) {
    throw new Error("Path is outside of the project root.");
  }
  return normalized;
};

const getFilePatch = async (
  projectPath,
  beforeTree,
  afterTree,
  filePath,
  previousPath,
) => {
  const pathspecs = previousPath ? [filePath, previousPath] : [filePath];
  const result = await runShadowGit(projectPath, [
    "diff-tree",
    "-r",
    "-p",
    "-M",
    "--no-color",
    "--no-ext-diff",
    "--binary",
    beforeTree,
    afterTree,
    "--",
    ...pathspecs,
  ]);
  return result.stdout;
};

export const getCheckpointFileDiff = ({
  chatId,
  checkpointId,
  filePath,
  previousPath = null,
  projectPath,
}) =>
  withProjectCheckpointLock(projectPath, async () => {
    const normalizedFilePath = normalizeRequestPath(projectPath, filePath);
    const normalizedPreviousPath = previousPath
      ? normalizeRequestPath(projectPath, previousPath)
      : null;
    const { afterTree, beforeTree } = await loadCheckpointTrees({
      chatId,
      checkpointId,
      projectPath,
    });
    const [change] = await listTreeChanges(
      projectPath,
      beforeTree,
      afterTree,
      normalizedPreviousPath
        ? [normalizedFilePath, normalizedPreviousPath]
        : [normalizedFilePath],
    );
    const diff = await getFilePatch(
      projectPath,
      beforeTree,
      afterTree,
      normalizedFilePath,
      normalizedPreviousPath,
    );

    return {
      binary: change?.binary ?? false,
      diff,
      filePath: normalizedFilePath,
      parsedDiff: parseSingleFileDiff(diff),
      previousPath: change?.previousPath ?? normalizedPreviousPath,
      status: change?.status ?? "modified",
    };
  });

const removeProjectFile = async (projectPath, filePath) => {
  const absolutePath = resolveProjectPath(projectPath, filePath);
  await fs.rm(absolutePath, { force: true, recursive: false });
};

const readTreeEntry = async (projectPath, tree, filePath) => {
  const result = await runShadowGit(
    projectPath,
    ["ls-tree", "-z", tree, "--", filePath],
    { allowFailure: true },
  );
  if (!result.ok) {
    return null;
  }
  const [entry] = result.stdout.split("\0");
  if (!entry) {
    return null;
  }
  const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.*)$/.exec(entry);
  if (!match) {
    return null;
  }
  return { mode: match[1], object: match[3], type: match[2] };
};

const writeFileFromTree = async (projectPath, tree, filePath) => {
  const entry = await readTreeEntry(projectPath, tree, filePath);
  if (!entry) {
    await removeProjectFile(projectPath, filePath);
    return;
  }
  if (entry.type !== "blob") {
    throw new Error("Only regular files can be restored.");
  }
  if (entry.mode === "120000") {
    throw new Error("Symbolic links cannot be restored.");
  }

  const contents = await runShadowGit(
    projectPath,
    ["cat-file", "blob", entry.object],
    { encoding: "buffer" },
  );
  const absolutePath = resolveProjectPath(projectPath, filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents.stdout);
};

const restoreFileByOverwrite = async ({
  beforeTree,
  filePath,
  previousPath,
  projectPath,
}) => {
  if (previousPath && previousPath !== filePath) {
    await writeFileFromTree(projectPath, beforeTree, previousPath);
    await removeProjectFile(projectPath, filePath);
    return;
  }
  await writeFileFromTree(projectPath, beforeTree, filePath);
};

const restoreFileByMerge = async ({
  afterTree,
  beforeTree,
  filePath,
  previousPath,
  projectPath,
}) => {
  const patch = await getFilePatch(
    projectPath,
    beforeTree,
    afterTree,
    filePath,
    previousPath,
  );
  if (!patch.trim()) {
    return { message: null, ok: true };
  }

  const applyArgs = ["apply", "-R", "--whitespace=nowarn"];
  const check = await runShadowGitWithInput(
    projectPath,
    [...applyArgs, "--check"],
    patch,
  );
  if (!check.ok) {
    return { message: check.stderr.trim() || null, ok: false };
  }

  const apply = await runShadowGitWithInput(projectPath, applyArgs, patch);
  if (!apply.ok) {
    return { message: apply.stderr.trim() || null, ok: false };
  }
  return { message: null, ok: true };
};

export const restoreCheckpointFiles = ({
  chatId,
  checkpointId,
  filePaths,
  mode = "merge",
  projectPath,
}) =>
  withProjectCheckpointLock(projectPath, async () => {
    const { afterTree, beforeTree } = await loadCheckpointTrees({
      chatId,
      checkpointId,
      projectPath,
    });
    const changes = await listTreeChanges(projectPath, beforeTree, afterTree);
    const changesByPath = new Map(
      changes.map((change) => [change.filePath, change]),
    );

    const results = [];
    for (const requestedPath of filePaths) {
      let filePath;
      try {
        filePath = normalizeRequestPath(projectPath, requestedPath);
      } catch (error) {
        results.push({
          filePath: requestedPath,
          message: error instanceof Error ? error.message : String(error),
          status: "error",
        });
        continue;
      }

      const change = changesByPath.get(filePath);
      if (!change) {
        results.push({
          filePath,
          message: "This file was not changed in the turn.",
          status: "error",
        });
        continue;
      }

      try {
        if (mode === "overwrite") {
          await restoreFileByOverwrite({
            beforeTree,
            filePath,
            previousPath: change.previousPath,
            projectPath,
          });
          results.push({ filePath, message: null, status: "restored" });
          continue;
        }

        const merged = await restoreFileByMerge({
          afterTree,
          beforeTree,
          filePath,
          previousPath: change.previousPath,
          projectPath,
        });
        results.push({
          filePath,
          message: merged.message,
          status: merged.ok ? "restored" : "conflict",
        });
      } catch (error) {
        results.push({
          filePath,
          message: error instanceof Error ? error.message : String(error),
          status: "error",
        });
      }
    }

    return { results };
  });

export const deleteChatCheckpoints = ({ chatId, projectPath }) =>
  withProjectCheckpointLock(projectPath, async () => {
    await ensureShadowRepository(projectPath);
    const prefix = `${REF_NAMESPACE}/${sanitizeRefSegment(chatId)}/`;
    const result = await runShadowGit(
      projectPath,
      ["for-each-ref", "--format=%(refname)", prefix],
      { allowFailure: true },
    );
    if (!result.ok) {
      return 0;
    }
    const refs = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const ref of refs) {
      await runShadowGit(projectPath, ["update-ref", "-d", ref], {
        allowFailure: true,
      });
    }
    return refs.length;
  });

/**
 * Wraps a streaming chat response so the checkpoint's "after" snapshot is
 * captured once the stream finishes or the client aborts.
 */
export const attachCheckpointFinalizer = (response, abortSignal, finalize) => {
  if (!response?.body) {
    return response;
  }

  let finalized = false;
  const runFinalize = () => {
    if (finalized) {
      return;
    }
    finalized = true;
    abortSignal?.removeEventListener("abort", runFinalize);
    Promise.resolve()
      .then(finalize)
      .catch((error) => {
        console.warn("[checkpoints] Failed to finalize checkpoint:", error);
      });
  };

  abortSignal?.addEventListener("abort", runFinalize, { once: true });

  const transform = new TransformStream({
    cancel() {
      runFinalize();
    },
    flush() {
      runFinalize();
    },
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });

  return new Response(response.body.pipeThrough(transform), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
