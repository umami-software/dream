import assert from "node:assert/strict";
import { test } from "vitest";
import { createStore } from "zustand/vanilla";
import { createProjectConfig, DEFAULT_SETTINGS } from "@/lib/ide-defaults";
import { createChatActions } from "./chat-actions";
import type { IdeState } from "./ide-store-types";
import { createStashActions } from "./stash-actions";

const createTestStore = () => {
  const project = createProjectConfig("/workspace/source", DEFAULT_SETTINGS);
  const store = createStore<IdeState>(
    () =>
      ({
        activeProjectId: project.id,
        chats: [],
        chatSort: "recent",
        closedProjects: [],
        completedChatIds: {},
        draftChatIdByProject: {},
        messagesByChatId: {},
        pendingChatSubmitByChatId: {},
        projects: [project],
        settings: DEFAULT_SETTINGS,
        streamingChatIds: {},
        titleGeneratingChatIds: {},
      }) as unknown as IdeState,
  );
  store.setState({
    ...createChatActions(store.setState, store.getState),
    ...createStashActions(store.setState, store.getState),
  });

  return { project, store };
};

test("adds, updates, and deletes stash items", () => {
  const { project, store } = createTestStore();

  const itemId = store.getState().addStashItem(project.id, {
    agentMode: "build",
    model: "gpt-5",
    modelSpeed: "standard",
    permissionMode: "full-access",
    provider: "openai",
    reasoningEffort: null,
    references: [],
    text: "  first task  ",
  });

  assert.ok(itemId);
  const added = store
    .getState()
    .projects[0]?.ui.stashItems.find((item) => item.id === itemId);
  assert.equal(added?.text, "first task");

  store.getState().updateStashItem(project.id, itemId, (item) => ({
    ...item,
    text: "updated task",
    agentMode: "plan",
  }));

  const updated = store
    .getState()
    .projects[0]?.ui.stashItems.find((item) => item.id === itemId);
  assert.equal(updated?.text, "updated task");
  assert.equal(updated?.agentMode, "plan");

  store.getState().deleteStashItem(project.id, itemId);
  assert.deepEqual(store.getState().projects[0]?.ui.stashItems, []);
});

test("executeStashItem opens a new chat and queues the prompt", () => {
  const { project, store } = createTestStore();
  const itemId = store.getState().addStashItem(project.id, {
    agentMode: "plan",
    model: "gpt-5",
    modelSpeed: "fast",
    permissionMode: "standard",
    provider: "openai",
    reasoningEffort: "high",
    references: [],
    text: "run this later",
  });
  assert.ok(itemId);

  const draftId = store.getState().addChat(project.id);
  const chatId = store.getState().executeStashItem(project.id, itemId);
  assert.ok(chatId);
  assert.notEqual(chatId, draftId);

  const state = store.getState();
  const chat = state.chats.find((item) => item.id === chatId);
  assert.equal(chat?.agentMode, "plan");
  assert.equal(chat?.model, "gpt-5");
  assert.equal(chat?.modelSpeed, "fast");
  assert.equal(chat?.permissionMode, "standard");
  assert.deepEqual(state.pendingChatSubmitByChatId[chatId], {
    references: [],
    text: "run this later",
  });
  assert.deepEqual(state.projects[0]?.ui.stashItems, []);
  assert.equal(state.projects[0]?.ui.activeChatId, chatId);
  assert.deepEqual(state.projects[0]?.ui.openChatIds, [chatId]);

  const firstTake = state.takePendingChatSubmit(chatId);
  assert.deepEqual(firstTake, {
    references: [],
    text: "run this later",
  });
  assert.equal(store.getState().takePendingChatSubmit(chatId), null);
  assert.equal(
    Object.hasOwn(store.getState().pendingChatSubmitByChatId, chatId),
    false,
  );
});

test("executeStashItem adds a chat beside open chats in multi-chat mode", () => {
  const { project, store } = createTestStore();
  const firstChatId = store.getState().addChat(project.id);
  assert.ok(firstChatId);
  store.getState().addChatBeside(project.id);

  const itemId = store.getState().addStashItem(project.id, {
    agentMode: "build",
    model: "gpt-5",
    modelSpeed: "standard",
    permissionMode: "full-access",
    provider: "openai",
    reasoningEffort: null,
    references: [],
    text: "queued beside",
  });
  assert.ok(itemId);

  const openBefore = store.getState().projects[0]?.ui.openChatIds ?? [];
  const chatId = store.getState().executeStashItem(project.id, itemId);
  assert.ok(chatId);

  const openAfter = store.getState().projects[0]?.ui.openChatIds ?? [];
  assert.equal(store.getState().projects[0]?.ui.multiChat, true);
  assert.deepEqual(openAfter, [...openBefore, chatId]);
  assert.equal(store.getState().projects[0]?.ui.activeChatId, chatId);
});

test("feedback is handed to an existing chat immediately without a mounted send handler", () => {
  const { project, store } = createTestStore();
  const first = store.getState().addChat(project.id);
  const second = store
    .getState()
    .addChat(project.id, undefined, { forceNew: true });
  assert.ok(first);
  assert.ok(second);
  // The chat can receive the handoff before its history or component is loaded.
  store.setState({ messagesByChatId: {} });
  const submission = {
    text: "Review these changed lines",
    references: [],
    preserveDraft: true,
  };
  assert.equal(store.getState().queueChatSubmit(first, submission), true);
  assert.equal(store.getState().projects[0].ui.activeChatId, first);
  assert.deepEqual(
    store.getState().pendingChatSubmitByChatId[first],
    submission,
  );
  assert.equal(store.getState().pendingChatSubmitByChatId[second], undefined);
  assert.deepEqual(store.getState().takePendingChatSubmit(first), submission);
  assert.equal(store.getState().takePendingChatSubmit(first), null);
});

test("new chats receive feedback through the regular submission flow", () => {
  const { project, store } = createTestStore();
  const chatId = store
    .getState()
    .addChat(project.id, undefined, { forceNew: true });
  assert.ok(chatId);
  assert.equal(
    store.getState().queueChatSubmit(chatId, {
      text: "feedback",
      references: [],
      preserveDraft: true,
    }),
    true,
  );
  assert.equal(
    store.getState().takePendingChatSubmit(chatId)?.text,
    "feedback",
  );
});

test("feedback never overwrites a pending submission or sends to a busy or inactive chat", () => {
  const { project, store } = createTestStore();
  const chatId = store.getState().addChat(project.id);
  assert.ok(chatId);
  const first = { text: "first", references: [] };
  assert.equal(store.getState().queueChatSubmit(chatId, first), true);
  assert.equal(
    store
      .getState()
      .queueChatSubmit(chatId, { text: "second", references: [] }),
    false,
  );
  assert.deepEqual(store.getState().takePendingChatSubmit(chatId), first);
  store.setState({ streamingChatIds: { [chatId]: true } });
  assert.equal(store.getState().queueChatSubmit(chatId, first), false);
  store.setState({ streamingChatIds: {}, activeProjectId: null });
  assert.equal(store.getState().queueChatSubmit(chatId, first), false);
  assert.equal(store.getState().queueChatSubmit("missing-chat", first), false);
});
