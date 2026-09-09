import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dream-test-user-data" },
}));

const { registerProjectGitRoutes } = await import("./project-git-routes.js");

const execFileAsync = promisify(execFile);
const hasGit = await execFileAsync("git", ["--version"]).then(
  () => true,
  () => false,
);
const gitTest = hasGit ? test : test.skip;

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

const git = async (cwd, args) => {
  const result = await execFileAsync(
    "git",
    ["-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return result.stdout.trim();
};

const createTempDirectory = async (prefix) => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), prefix)),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const commitFile = async (cwd, filePath, content, message) => {
  await fs.mkdir(path.dirname(path.join(cwd, filePath)), { recursive: true });
  await fs.writeFile(path.join(cwd, filePath), content);
  await git(cwd, ["add", "--", filePath]);
  await git(cwd, ["commit", "-m", message]);
};

const createGitRepo = async () => {
  const repoPath = await createTempDirectory("dream-wt-repo-");
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Dream Test"]);
  await commitFile(repoPath, "README.md", "# Repo\n", "Initial commit");
  return repoPath;
};

const createWorktree = async (repoPath, branchName) => {
  const parent = await createTempDirectory("dream-wt-tree-");
  const worktreePath = path.join(parent, "wt");
  await git(repoPath, ["worktree", "add", "-b", branchName, worktreePath]);
  await git(worktreePath, ["config", "user.email", "test@example.com"]);
  await git(worktreePath, ["config", "user.name", "Dream Test"]);
  return worktreePath;
};

const createApp = () => {
  const app = new Hono();
  registerProjectGitRoutes(app);
  return app;
};

const post = (app, route, body) =>
  app.request(route, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const compare = (app, projectPath, baseRef = null) =>
  post(app, "/api/project-git-worktree-compare", { baseRef, projectPath });

const merge = (app, projectPath, options = {}) =>
  post(app, "/api/project-git-worktree-merge", { projectPath, ...options });

const cleanup = (app, projectPath, worktreePath, options = {}) =>
  post(app, "/api/project-git-worktree-cleanup", {
    projectPath,
    worktreePath,
    ...options,
  });

const expectJson = async (response) => {
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
};

const listWorktreePaths = async (repoPath) =>
  (await git(repoPath, ["worktree", "list", "--porcelain"]))
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

gitTest(
  "compare reports commits, files, dirty state and base fallback",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/one");
    await commitFile(
      worktreePath,
      "src/new.ts",
      "export const a = 1;\n",
      "Add a",
    );
    await fs.writeFile(path.join(worktreePath, "dirty.txt"), "dirty\n");

    const response = await compare(createApp(), worktreePath, "HEAD");
    const payload = await expectJson(response);

    assert.equal(payload.baseBranch, "main");
    assert.equal(payload.baseExistsLocally, true);
    assert.equal(payload.branch, "feature/one");
    assert.equal(payload.aheadCount, 1);
    assert.equal(payload.behindCount, 0);
    assert.equal(payload.commits.length, 1);
    assert.equal(payload.commits[0].subject, "Add a");
    assert.equal(payload.files.length, 1);
    assert.equal(payload.files[0].path, "src/new.ts");
    assert.equal(payload.files[0].status, "added");
    assert.equal(payload.files[0].addedLines, 1);
    assert.equal(payload.worktreeStatus.fileCount, 1);
    assert.equal(payload.worktreeStatus.changes[0].path, "dirty.txt");
    assert.equal(payload.mainBranch, "main");
    assert.equal(payload.mainClean, true);
    assert.equal(payload.mainInProgressOperation, false);
    assert.equal(path.resolve(payload.mainWorktreePath), repoPath);
    assert.equal(typeof payload.mergeBase, "string");
  },
);

gitTest("compare rejects the main worktree", async () => {
  const repoPath = await createGitRepo();
  const response = await compare(createApp(), repoPath);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /not a linked worktree/i);
});

gitTest(
  "compare-diff returns a parsed diff against the merge base",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/diff");
    await commitFile(worktreePath, "src/new.ts", "line one\nline two\n", "Add");

    const response = await post(
      createApp(),
      "/api/project-git-worktree-compare-diff",
      {
        baseRef: null,
        filePath: "src/new.ts",
        previousPath: null,
        projectPath: worktreePath,
        status: "added",
      },
    );
    const payload = await expectJson(response);
    assert.equal(payload.filePath, "src/new.ts");
    assert.match(payload.diff, /\+line one/);
    assert.ok(payload.parsedDiff);
  },
);

gitTest(
  "merge fast-forwards the base branch in the main worktree",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/ff");
    await commitFile(worktreePath, "src/ff.ts", "ff\n", "Add ff");
    const branchHead = await git(worktreePath, ["rev-parse", "HEAD"]);

    const response = await merge(createApp(), worktreePath);
    const payload = await expectJson(response);
    assert.equal(payload.status, "merged");
    assert.equal(payload.fastForward, true);
    assert.equal(payload.mergeCommit, branchHead);
    assert.equal(payload.previousMainBranch, "main");
    assert.equal(await git(repoPath, ["rev-parse", "main"]), branchHead);
  },
);

gitTest("merge creates a merge commit when histories diverged", async () => {
  const repoPath = await createGitRepo();
  const worktreePath = await createWorktree(repoPath, "feature/diverged");
  await commitFile(worktreePath, "src/feature.ts", "feature\n", "Add feature");
  await commitFile(repoPath, "src/main.ts", "main\n", "Add main file");
  const branchHead = await git(worktreePath, ["rev-parse", "HEAD"]);

  const response = await merge(createApp(), worktreePath);
  const payload = await expectJson(response);
  assert.equal(payload.status, "merged");
  assert.equal(payload.fastForward, false);
  assert.notEqual(payload.mergeCommit, branchHead);
  await fs.access(path.join(repoPath, "src/feature.ts"));
});

gitTest("merge aborts cleanly on conflicts and reports files", async () => {
  const repoPath = await createGitRepo();
  const worktreePath = await createWorktree(repoPath, "feature/conflict");
  await commitFile(worktreePath, "README.md", "# Worktree\n", "Worktree edit");
  await commitFile(repoPath, "README.md", "# Main\n", "Main edit");
  const mainHead = await git(repoPath, ["rev-parse", "HEAD"]);

  const response = await merge(createApp(), worktreePath);
  const payload = await expectJson(response);
  assert.equal(payload.status, "conflict");
  assert.deepEqual(payload.conflictingFiles, ["README.md"]);
  assert.equal(await git(repoPath, ["rev-parse", "HEAD"]), mainHead);
  await assert.rejects(
    git(repoPath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]),
  );
  assert.equal(await git(repoPath, ["status", "--porcelain"]), "");
});

gitTest("merge refuses dirty main or worktree checkouts", async () => {
  const repoPath = await createGitRepo();
  const worktreePath = await createWorktree(repoPath, "feature/dirty");
  await commitFile(worktreePath, "src/x.ts", "x\n", "Add x");
  const app = createApp();

  await fs.writeFile(path.join(repoPath, "README.md"), "# Dirty main\n");
  const dirtyMain = await merge(app, worktreePath);
  assert.equal(dirtyMain.status, 400);
  assert.match(await dirtyMain.text(), /main worktree has uncommitted/i);
  await git(repoPath, ["checkout", "--", "README.md"]);

  await fs.writeFile(path.join(worktreePath, "src/x.ts"), "changed\n");
  const dirtyWorktree = await merge(app, worktreePath);
  assert.equal(dirtyWorktree.status, 400);
  assert.match(await dirtyWorktree.text(), /worktree has uncommitted/i);

  const acknowledged = await merge(app, worktreePath, {
    acknowledgeUncommitted: true,
  });
  assert.equal((await expectJson(acknowledged)).status, "merged");
});

gitTest("merge refuses when there is nothing to merge", async () => {
  const repoPath = await createGitRepo();
  const worktreePath = await createWorktree(repoPath, "feature/empty");

  const response = await merge(createApp(), worktreePath);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /no commits to merge/i);
});

gitTest(
  "cleanup removes the worktree and deletes a merged branch",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/done");
    await commitFile(worktreePath, "src/done.ts", "done\n", "Add done");
    const app = createApp();
    assert.equal((await merge(app, worktreePath)).status, 200);

    const response = await cleanup(app, repoPath, worktreePath, {
      deleteBranch: true,
    });
    const payload = await expectJson(response);
    assert.equal(payload.removed, true);
    assert.equal(payload.branchDeleted, true);
    assert.equal(payload.branchDeleteError, null);
    assert.equal(payload.pruned, false);
    await assert.rejects(fs.access(worktreePath));
    assert.deepEqual(await listWorktreePaths(repoPath), [
      await git(repoPath, ["rev-parse", "--show-toplevel"]),
    ]);
    await assert.rejects(
      git(repoPath, [
        "show-ref",
        "--verify",
        "--quiet",
        "refs/heads/feature/done",
      ]),
    );
  },
);

gitTest(
  "cleanup keeps an unmerged branch and reports the delete failure",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/unmerged");
    await commitFile(worktreePath, "src/u.ts", "u\n", "Add u");

    const response = await cleanup(createApp(), repoPath, worktreePath, {
      deleteBranch: true,
    });
    const payload = await expectJson(response);
    assert.equal(payload.removed, true);
    assert.equal(payload.branchDeleted, false);
    assert.ok(payload.branchDeleteError);
    assert.equal(
      await git(repoPath, [
        "show-ref",
        "--verify",
        "--quiet",
        "refs/heads/feature/unmerged",
      ]),
      "",
    );
  },
);

gitTest("cleanup requires force for dirty worktrees", async () => {
  const repoPath = await createGitRepo();
  const worktreePath = await createWorktree(repoPath, "feature/force");
  await fs.writeFile(path.join(worktreePath, "untracked.txt"), "x\n");
  const app = createApp();

  const refused = await cleanup(app, repoPath, worktreePath);
  assert.equal(refused.status, 400);
  await fs.access(worktreePath);

  const forced = await cleanup(app, repoPath, worktreePath, { force: true });
  await expectJson(forced);
  await assert.rejects(fs.access(worktreePath));
});

gitTest(
  "cleanup prunes worktrees whose directory was deleted manually",
  async () => {
    const repoPath = await createGitRepo();
    const worktreePath = await createWorktree(repoPath, "feature/gone");
    await fs.rm(worktreePath, { force: true, recursive: true });

    const response = await cleanup(createApp(), repoPath, worktreePath);
    const payload = await expectJson(response);
    assert.equal(payload.removed, true);
    assert.equal(typeof payload.pruned, "boolean");
    assert.equal((await listWorktreePaths(repoPath)).length, 1);
  },
);

gitTest("cleanup reports unknown worktrees", async () => {
  const repoPath = await createGitRepo();
  const response = await cleanup(
    createApp(),
    repoPath,
    path.join(repoPath, "does-not-exist"),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /worktree was not found/i);
});
