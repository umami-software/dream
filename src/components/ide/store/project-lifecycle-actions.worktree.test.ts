import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { test, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  createChatConfig,
  createProjectConfig,
  DEFAULT_SETTINGS,
} from "@/lib/ide-defaults";
import { normalizeProjectPathKey } from "../ide-state";
import type { IdeState } from "./ide-store-types";
import { createProjectLifecycleActions } from "./project-lifecycle-actions";
import { createRuntimeActions } from "./runtime-actions";

const WORKTREE_PATH = "/workspace/worktrees/source-feature";

const createTestStore = () => {
  const parent = createProjectConfig("/workspace/source", DEFAULT_SETTINGS);
  const worktree = createProjectConfig(WORKTREE_PATH, DEFAULT_SETTINGS);
  worktree.worktree = {
    baseRef: "main",
    branch: "feature",
    createdAt: new Date().toISOString(),
    kind: "worktree",
    mainWorktreePath: parent.path,
    managed: true,
    parentProjectId: parent.id,
    repoRoot: parent.path,
  };
  const staleClosedWorktree = createProjectConfig(
    `${WORKTREE_PATH}/`,
    DEFAULT_SETTINGS,
  );
  const worktreeChat = createChatConfig(worktree, { title: "Worktree chat" });
  const parentChat = createChatConfig(parent, { title: "Parent chat" });
  const messages = [
    { id: "message-one", parts: [{ text: "one", type: "text" }], role: "user" },
  ] as UIMessage[];

  const store = createStore<IdeState>(
    () =>
      ({
        activeProjectId: worktree.id,
        chats: [worktreeChat, parentChat],
        chatSort: "recent",
        closedProjects: [staleClosedWorktree],
        completedChatIds: {},
        draftChatIdByProject: {},
        messagesByChatId: {
          [parentChat.id]: messages,
          [worktreeChat.id]: messages,
        },
        activeTerminalSessionIdByProject: {},
        browserLoading: {},
        browserTabsByProject: {},
        nextTerminalOrdinalByProject: {},
        projectFileOpenRequests: {},
        projectFilesRefreshKeys: {},
        projectGitRefreshKeys: {},
        projectTerminalPanelOpenByProject: {},
        projectTerminalSessionIds: {},
        terminalSessionNames: {},
        terminalShell: {},
        terminalStatus: {},
        terminalTransport: {},
        projects: [parent, worktree],
        settings: DEFAULT_SETTINGS,
        streamingChatIds: {},
        titleGeneratingChatIds: {},
      }) as unknown as IdeState,
  );
  store.setState({
    ...createProjectLifecycleActions(store.setState, store.getState),
    ...createRuntimeActions(store.setState),
  });

  return { parent, parentChat, store, worktree, worktreeChat };
};

const stubFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response,
) => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(input, init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const hasProjectPath = (state: IdeState, projectPath: string) =>
  [...state.projects, ...state.closedProjects].some(
    (project) =>
      normalizeProjectPathKey(project.path) ===
      normalizeProjectPathKey(projectPath),
  );

test("removeWorktreeProject cleans up the worktree and activates the parent", async () => {
  const { parent, parentChat, store, worktree, worktreeChat } =
    createTestStore();
  const fetchMock = stubFetch(() =>
    Response.json({
      branch: "feature",
      branchDeleted: true,
      branchDeleteError: null,
      path: WORKTREE_PATH,
      pruned: false,
      removed: true,
    }),
  );

  try {
    const result = await store.getState().removeWorktreeProject({
      deleteBranch: true,
      mainWorktreePath: parent.path,
      parentProjectId: parent.id,
      worktreePath: worktree.path,
    });

    assert.equal(result?.branchDeleted, true);
    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    assert.equal(url, "/api/project-git-worktree-cleanup");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      deleteBranch: true,
      force: false,
      projectPath: parent.path,
      worktreePath: worktree.path,
    });

    const state = store.getState();
    assert.equal(hasProjectPath(state, WORKTREE_PATH), false);
    assert.deepEqual(
      state.projects.map((project) => project.id),
      [parent.id],
    );
    assert.deepEqual(
      state.chats.map((chat) => chat.id),
      [parentChat.id],
    );
    assert.equal(state.messagesByChatId[worktreeChat.id], undefined);
    assert.ok(state.messagesByChatId[parentChat.id]);
    assert.equal(state.activeProjectId, parent.id);
    assert.equal(state.projectGitRefreshKeys[parent.id], 1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("removeWorktreeProject purges state when git no longer knows the worktree", async () => {
  const { parent, store, worktree } = createTestStore();
  stubFetch(
    () =>
      new Response("Worktree was not found for this repository.", {
        status: 400,
      }),
  );

  try {
    const result = await store.getState().removeWorktreeProject({
      mainWorktreePath: parent.path,
      parentProjectId: parent.id,
      worktreePath: worktree.path,
    });

    assert.equal(result, null);
    const state = store.getState();
    assert.equal(hasProjectPath(state, WORKTREE_PATH), false);
    assert.equal(state.activeProjectId, parent.id);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("removeWorktreeProject rethrows other failures without touching state", async () => {
  const { parent, store, worktree } = createTestStore();
  stubFetch(
    () =>
      new Response(
        "fatal: 'feature' contains modified or untracked files, use --force to delete it",
        { status: 400 },
      ),
  );
  const originalState = store.getState();

  try {
    await assert.rejects(
      store.getState().removeWorktreeProject({
        mainWorktreePath: parent.path,
        parentProjectId: parent.id,
        worktreePath: worktree.path,
      }),
      /modified or untracked files/,
    );

    const state = store.getState();
    assert.equal(state.projects, originalState.projects);
    assert.equal(state.chats, originalState.chats);
    assert.equal(state.closedProjects, originalState.closedProjects);
    assert.equal(state.activeProjectId, worktree.id);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("purgeWorktreeProject falls back when the activation target is missing", () => {
  const { parent, store, worktree } = createTestStore();

  store.getState().purgeWorktreeProject(worktree.path, {
    activateProjectId: "missing-project",
  });

  const state = store.getState();
  assert.equal(hasProjectPath(state, WORKTREE_PATH), false);
  assert.equal(state.activeProjectId, parent.id);
  assert.equal(state.projectGitRefreshKeys[parent.id], undefined);
});
