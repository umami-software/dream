import type { UIMessage } from "ai";
import { createChatConfig, getDefaultModelSelection } from "@/lib/ide-defaults";
import type { ChatConfig, ChatSortOrder, ProjectUiState } from "@/types/ide";
import {
  createBranchedChatConfig,
  getMessagesThroughBranchPoint,
} from "../chat-branching";
import { mergeChatMessageHistories } from "../chat-message-history";
import {
  ensureActiveChatForProject,
  sanitizeProjectUiForChats,
} from "../ide-state";
import {
  areMessagesEqual,
  shouldTouchChatUpdatedAt,
  updateProjectUiInList,
} from ".";
import { requestChatCheckpointCleanup } from "./checkpoint-cleanup";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";

export const createChatActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
): Pick<
  IdeState,
  | "addChat"
  | "addChatBeside"
  | "branchChatInWorkspace"
  | "branchChatInNewWorktree"
  | "toggleProjectMultiChatMode"
  | "setActiveChatId"
  | "updateChat"
  | "archiveInactiveChats"
  | "deleteChat"
  | "permanentlyDeleteChats"
  | "restoreChats"
  | "setMessagesForChat"
  | "setChatSort"
> => ({
  addChat: (
    projectId: string,
    title?: string,
    options?: { forceNew?: boolean },
  ) => {
    let nextChatId: string | null = null;

    set((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        return state;
      }

      const existingDraftChatId = state.draftChatIdByProject[projectId] ?? null;
      if (
        !options?.forceNew &&
        existingDraftChatId &&
        state.chats.some((item) => item.id === existingDraftChatId)
      ) {
        nextChatId = existingDraftChatId;
        return {
          activeProjectId: projectId,
          projects: updateProjectUiInList(
            state.projects,
            projectId,
            (item) => ({
              ...item.ui,
              activeChatId: existingDraftChatId,
              openChatIds: [existingDraftChatId],
              chatColumnWidths: {},
            }),
          ),
        };
      }

      const defaultSelection = getDefaultModelSelection(state.settings);
      const nextChat = createChatConfig(project, {
        model: defaultSelection.model || project.model,
        modelSpeed: defaultSelection.model
          ? defaultSelection.modelSpeed
          : project.modelSpeed,
        provider: defaultSelection.model
          ? defaultSelection.provider
          : project.provider,
        reasoningEffort: defaultSelection.model
          ? defaultSelection.reasoningEffort
          : project.reasoningEffort,
        title,
      });
      nextChatId = nextChat.id;

      return {
        activeProjectId: projectId,
        projects: updateProjectUiInList(state.projects, projectId, (item) => ({
          ...item.ui,
          activeChatId: nextChat.id,
          openChatIds: [nextChat.id],
          chatColumnWidths: {},
        })),
        draftChatIdByProject: {
          ...state.draftChatIdByProject,
          [projectId]: nextChat.id,
        },
        messagesByChatId: {
          ...state.messagesByChatId,
          [nextChat.id]: [],
        },
        chats: [...state.chats, nextChat],
      };
    });

    return nextChatId;
  },

  addChatBeside: (projectId: string) => {
    let nextChatId: string | null = null;

    set((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        return state;
      }

      const defaultSelection = getDefaultModelSelection(state.settings);
      const nextChat = createChatConfig(project, {
        model: defaultSelection.model || project.model,
        modelSpeed: defaultSelection.model
          ? defaultSelection.modelSpeed
          : project.modelSpeed,
        provider: defaultSelection.model
          ? defaultSelection.provider
          : project.provider,
        reasoningEffort: defaultSelection.model
          ? defaultSelection.reasoningEffort
          : project.reasoningEffort,
      });
      nextChatId = nextChat.id;
      const nextChats = [...state.chats, nextChat];

      return {
        activeProjectId: projectId,
        projects: updateProjectUiInList(state.projects, projectId, (item) =>
          sanitizeProjectUiForChats(
            nextChats,
            projectId,
            {
              ...item.ui,
              multiChat: true,
              openChatIds: [...item.ui.openChatIds, nextChat.id],
            },
            nextChat.id,
          ),
        ),
        draftChatIdByProject: {
          ...state.draftChatIdByProject,
          [projectId]: nextChat.id,
        },
        messagesByChatId: {
          ...state.messagesByChatId,
          [nextChat.id]: [],
        },
        chats: nextChats,
      };
    });

    return nextChatId;
  },

  branchChatInWorkspace: ({ chatId, messageId }) => {
    const state = get();
    const sourceChat = state.chats.find((chat) => chat.id === chatId);
    if (!sourceChat || sourceChat.deletedAt !== null) {
      throw new Error("Unable to find the source chat.");
    }
    if (state.streamingChatIds[chatId]) {
      throw new Error("Unable to branch a chat while it is streaming.");
    }

    const project = state.projects.find(
      (item) => item.id === sourceChat.projectId,
    );
    if (!project) {
      throw new Error("Unable to find the source project.");
    }

    const messages = getMessagesThroughBranchPoint(
      state.messagesByChatId[chatId] ?? [],
      messageId,
    );
    const branchedChat = createBranchedChatConfig(
      sourceChat,
      project,
      messageId,
    );
    branchedChat.messageCount = messages.length;

    set((current) => ({
      activeProjectId: project.id,
      chats: [...current.chats, branchedChat],
      messagesByChatId: {
        ...current.messagesByChatId,
        [branchedChat.id]: messages,
      },
      projects: updateProjectUiInList(current.projects, project.id, (item) => {
        const sourceIndex = item.ui.openChatIds.indexOf(sourceChat.id);
        const insertionIndex =
          sourceIndex >= 0 ? sourceIndex + 1 : item.ui.openChatIds.length;
        const openChatIds = item.ui.multiChat
          ? [
              ...item.ui.openChatIds.slice(0, insertionIndex),
              branchedChat.id,
              ...item.ui.openChatIds.slice(insertionIndex),
            ]
          : [branchedChat.id];

        return sanitizeProjectUiForChats(
          [...current.chats, branchedChat],
          project.id,
          {
            ...item.ui,
            activeChatId: branchedChat.id,
            chatColumnWidths: item.ui.multiChat ? item.ui.chatColumnWidths : {},
            openChatIds,
          },
          branchedChat.id,
        );
      }),
    }));

    void get().persistMessagesForChat?.(branchedChat.id);

    return branchedChat.id;
  },

  branchChatInNewWorktree: async ({
    baseRef,
    branchName,
    chatId,
    messageId,
  }) => {
    const state = get();
    const sourceChat = state.chats.find((chat) => chat.id === chatId);
    if (!sourceChat || sourceChat.deletedAt !== null) {
      throw new Error("Unable to find the source chat.");
    }
    if (state.streamingChatIds[chatId]) {
      throw new Error("Unable to branch a chat while it is streaming.");
    }
    if (
      !state.projects.some((project) => project.id === sourceChat.projectId)
    ) {
      throw new Error("Unable to find the source project.");
    }

    const messages = getMessagesThroughBranchPoint(
      state.messagesByChatId[chatId] ?? [],
      messageId,
    );
    const result = await get().createWorktreeProject(sourceChat.projectId, {
      baseRef,
      branchName,
      initialChatSeed: {
        messageId,
        messages,
        sourceChat: structuredClone(sourceChat),
      },
    });

    if (!result?.chatId) {
      throw new Error("Unable to create the branched chat.");
    }

    return { chatId: result.chatId, projectId: result.projectId };
  },

  toggleProjectMultiChatMode: (projectId: string) => {
    set((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        return state;
      }

      const multiChat = !project.ui.multiChat;
      const preferredActiveChatId =
        project.ui.activeChatId ?? project.ui.openChatIds[0] ?? null;

      return {
        projects: updateProjectUiInList(state.projects, projectId, (item) =>
          sanitizeProjectUiForChats(
            state.chats,
            projectId,
            {
              ...item.ui,
              chatColumnWidths: multiChat ? item.ui.chatColumnWidths : {},
              multiChat,
            },
            preferredActiveChatId,
          ),
        ),
      };
    });
  },

  setActiveChatId: (projectId: string, chatId: string | null) => {
    set((state) => {
      const nextActiveChatId =
        chatId &&
        state.chats.some(
          (chat) =>
            chat.projectId === projectId &&
            chat.id === chatId &&
            chat.deletedAt === null,
        )
          ? chatId
          : ensureActiveChatForProject(state.chats, projectId, chatId);

      const nextCompletedChatIds = { ...state.completedChatIds };
      if (nextActiveChatId) {
        delete nextCompletedChatIds[nextActiveChatId];
      }

      return {
        completedChatIds: nextCompletedChatIds,
        projects: updateProjectUiInList(state.projects, projectId, (project) =>
          sanitizeProjectUiForChats(
            state.chats,
            projectId,
            project.ui,
            nextActiveChatId,
          ),
        ),
      };
    });
  },

  updateChat: (chatId: string, updater: (chat: ChatConfig) => ChatConfig) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? updater(chat) : chat,
      ),
    }));
  },

  archiveInactiveChats: () => {
    const state = get();
    const days = state.settings.archiveChatsAfterDays;
    if (!Number.isInteger(days) || days < 1) {
      return 0;
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const chatIds = state.chats
      .filter((chat) => {
        if (
          chat.deletedAt !== null ||
          state.streamingChatIds[chat.id] ||
          state.titleGeneratingChatIds[chat.id]
        ) {
          return false;
        }

        const lastActivityAt = Date.parse(chat.updatedAt || chat.createdAt);
        return Number.isFinite(lastActivityAt) && lastActivityAt <= cutoff;
      })
      .map((chat) => chat.id);

    for (const chatId of chatIds) {
      get().deleteChat(chatId);
    }

    return chatIds.length;
  },

  deleteChat: (chatId: string) => {
    let projectIdNeedingNewChat: string | null = null;

    set((state) => {
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) {
        return state;
      }

      const deletedAt = new Date().toISOString();
      const nextChats = state.chats.map((item) =>
        item.id === chatId ? { ...item, deletedAt } : item,
      );
      const nextDraftChatIdByProject = { ...state.draftChatIdByProject };
      if (nextDraftChatIdByProject[chat.projectId] === chatId) {
        nextDraftChatIdByProject[chat.projectId] = null;
      }
      const sanitizeUiAfterDelete = (project: { ui: ProjectUiState }) => {
        const deletedOpenIndex = project.ui.openChatIds.indexOf(chatId);
        const openChatIds = project.ui.openChatIds.filter(
          (openChatId) => openChatId !== chatId,
        );
        const preferredActiveChatId =
          project.ui.activeChatId === chatId
            ? (openChatIds[deletedOpenIndex] ??
              openChatIds[deletedOpenIndex - 1] ??
              null)
            : project.ui.activeChatId;

        if (project.ui.activeChatId === chatId && openChatIds.length === 0) {
          projectIdNeedingNewChat = chat.projectId;
        }

        return sanitizeProjectUiForChats(
          nextChats,
          chat.projectId,
          {
            ...project.ui,
            openChatIds,
          },
          preferredActiveChatId,
        );
      };

      const nextCompletedChatIds = { ...state.completedChatIds };
      delete nextCompletedChatIds[chatId];

      return {
        completedChatIds: nextCompletedChatIds,
        projects: updateProjectUiInList(
          state.projects,
          chat.projectId,
          sanitizeUiAfterDelete,
        ),
        closedProjects: updateProjectUiInList(
          state.closedProjects,
          chat.projectId,
          sanitizeUiAfterDelete,
        ),
        draftChatIdByProject: nextDraftChatIdByProject,
        chats: nextChats,
      };
    });

    if (projectIdNeedingNewChat) {
      get().addChat(projectIdNeedingNewChat);
    }
  },

  permanentlyDeleteChats: (chatIds: string[]) => {
    const idsToDelete = new Set(chatIds);
    if (idsToDelete.size === 0) {
      return;
    }

    {
      const current = get();
      requestChatCheckpointCleanup(
        current.chats.filter((chat) => idsToDelete.has(chat.id)),
        [...current.projects, ...current.closedProjects],
      );
    }

    set((state) => {
      const deletedChats = state.chats.filter((chat) =>
        idsToDelete.has(chat.id),
      );
      if (deletedChats.length === 0) {
        return state;
      }

      const affectedProjectIds = new Set(
        deletedChats.map((chat) => chat.projectId),
      );
      const nextChats = state.chats.filter((chat) => !idsToDelete.has(chat.id));
      const nextMessagesByChatId = { ...state.messagesByChatId };
      const nextDraftChatIdByProject = { ...state.draftChatIdByProject };
      const nextCompletedChatIds = { ...state.completedChatIds };

      for (const chat of deletedChats) {
        delete nextMessagesByChatId[chat.id];
        delete nextCompletedChatIds[chat.id];
        if (nextDraftChatIdByProject[chat.projectId] === chat.id) {
          nextDraftChatIdByProject[chat.projectId] = null;
        }
      }

      return {
        projects: state.projects.map((project) =>
          affectedProjectIds.has(project.id)
            ? {
                ...project,
                ui: sanitizeProjectUiForChats(
                  nextChats,
                  project.id,
                  project.ui,
                  ensureActiveChatForProject(
                    nextChats,
                    project.id,
                    project.ui.activeChatId,
                  ),
                ),
              }
            : project,
        ),
        closedProjects: state.closedProjects.map((project) =>
          affectedProjectIds.has(project.id)
            ? {
                ...project,
                ui: sanitizeProjectUiForChats(
                  nextChats,
                  project.id,
                  project.ui,
                  ensureActiveChatForProject(
                    nextChats,
                    project.id,
                    project.ui.activeChatId,
                  ),
                ),
              }
            : project,
        ),
        completedChatIds: nextCompletedChatIds,
        draftChatIdByProject: nextDraftChatIdByProject,
        messagesByChatId: nextMessagesByChatId,
        chats: nextChats,
      };
    });
  },

  restoreChats: (chatIds: string[]) => {
    const idsToRestore = new Set(chatIds);
    if (idsToRestore.size === 0) {
      return;
    }

    set((state) => ({
      chats: state.chats.map((chat) =>
        idsToRestore.has(chat.id) ? { ...chat, deletedAt: null } : chat,
      ),
    }));
  },

  setMessagesForChat: (chatId: string, messages: UIMessage[]) => {
    set((state) => {
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) {
        return state;
      }
      const previousMessages = state.messagesByChatId[chatId];
      const mergedMessages = mergeChatMessageHistories(
        previousMessages,
        messages,
      );

      const messagesChanged = !areMessagesEqual(
        previousMessages,
        mergedMessages,
      );

      if (!messagesChanged) {
        return state;
      }

      const touchUpdatedAt = shouldTouchChatUpdatedAt(
        previousMessages,
        mergedMessages,
      );

      const nextDraftChatIdByProject = { ...state.draftChatIdByProject };
      if (
        mergedMessages.length > 0 &&
        nextDraftChatIdByProject[chat.projectId] === chatId
      ) {
        nextDraftChatIdByProject[chat.projectId] = null;
      }

      return {
        draftChatIdByProject: nextDraftChatIdByProject,
        messagesByChatId: {
          ...state.messagesByChatId,
          [chatId]: mergedMessages,
        },
        chats: state.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                messageCount: mergedMessages.length,
                ...(touchUpdatedAt
                  ? { updatedAt: new Date().toISOString() }
                  : {}),
              }
            : item,
        ),
      };
    });
  },

  setChatSort: (chatSort: ChatSortOrder) => set({ chatSort }),
});
