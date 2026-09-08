import { getDesktopApi } from "@/lib/electron";
import { useActivityStore } from "../activity-store";
import type { IdeState, IdeStoreSet } from "./ide-store-types";

export const createRuntimeActions = (
  set: IdeStoreSet,
): Pick<
  IdeState,
  | "setTerminalStatus"
  | "setTerminalTransport"
  | "setTerminalShell"
  | "setTerminalSessionName"
  | "setChatStreaming"
  | "setChatAwaitingAnswer"
  | "setChatTitleGenerating"
  | "bumpProjectGitRefreshKey"
  | "bumpProjectFilesRefreshKey"
  | "setIsMacOs"
  | "setIsElectron"
  | "setAppReady"
  | "openExternalUrl"
  | "openExternalPath"
> => ({
  setTerminalStatus: (projectId, status) => {
    set((state) => ({
      terminalStatus: { ...state.terminalStatus, [projectId]: status },
    }));
  },

  setTerminalTransport: (projectId, transport) => {
    set((state) => ({
      terminalTransport: { ...state.terminalTransport, [projectId]: transport },
    }));
  },

  setTerminalShell: (projectId, shell) => {
    set((state) => ({
      terminalShell: { ...state.terminalShell, [projectId]: shell },
    }));
  },

  setTerminalSessionName: (sessionId, name) => {
    const normalizedSessionId =
      typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return;
    }

    const normalizedName = name.trim();
    set((state) => {
      const nextTerminalSessionNames = { ...state.terminalSessionNames };

      if (normalizedName) {
        nextTerminalSessionNames[normalizedSessionId] = normalizedName;
      } else {
        delete nextTerminalSessionNames[normalizedSessionId];
      }

      return {
        terminalSessionNames: nextTerminalSessionNames,
      };
    });
  },

  setChatStreaming: (chatId, streaming) =>
    set((state) => {
      const nextStreamingChatIds = { ...state.streamingChatIds };
      const nextAwaitingAnswerChatIds = { ...state.awaitingAnswerChatIds };
      const nextCompletedChatIds = { ...state.completedChatIds };

      if (streaming) {
        if (!state.streamingChatIds[chatId])
          useActivityStore.getState().start(chatId);
        nextStreamingChatIds[chatId] = true;
        delete nextCompletedChatIds[chatId];
      } else {
        const wasStreaming = Boolean(state.streamingChatIds[chatId]);
        const activity = useActivityStore.getState().entries[chatId];
        if (wasStreaming && activity?.status === "running") {
          useActivityStore.getState().finish(chatId, "interrupted");
        }
        delete nextStreamingChatIds[chatId];
        delete nextAwaitingAnswerChatIds[chatId];

        const chat = state.chats.find((item) => item.id === chatId);
        const project = chat
          ? state.projects.find((item) => item.id === chat.projectId)
          : null;
        const isActiveVisibleChat =
          chat &&
          state.activeProjectId === chat.projectId &&
          project?.ui.activeChatId === chatId;

        if (
          wasStreaming &&
          chat &&
          chat.deletedAt === null &&
          !isActiveVisibleChat
        ) {
          nextCompletedChatIds[chatId] = true;
        } else {
          delete nextCompletedChatIds[chatId];
        }
      }

      return {
        awaitingAnswerChatIds: nextAwaitingAnswerChatIds,
        completedChatIds: nextCompletedChatIds,
        streamingChatIds: nextStreamingChatIds,
      };
    }),

  setChatAwaitingAnswer: (chatId, awaiting) =>
    set((state) => {
      if (Boolean(state.awaitingAnswerChatIds[chatId]) === awaiting) {
        return state;
      }

      const awaitingAnswerChatIds = { ...state.awaitingAnswerChatIds };
      if (awaiting) {
        awaitingAnswerChatIds[chatId] = true;
      } else {
        delete awaitingAnswerChatIds[chatId];
      }
      return { awaitingAnswerChatIds };
    }),

  setChatTitleGenerating: (chatId, generating) =>
    set((state) => {
      const next = { ...state.titleGeneratingChatIds };
      if (generating) {
        next[chatId] = true;
      } else {
        delete next[chatId];
      }
      return { titleGeneratingChatIds: next };
    }),

  bumpProjectGitRefreshKey: (projectId) => {
    const normalizedProjectId =
      typeof projectId === "string" ? projectId.trim() : "";
    if (!normalizedProjectId) {
      return;
    }

    set((state) => ({
      projectGitRefreshKeys: {
        ...state.projectGitRefreshKeys,
        [normalizedProjectId]:
          (state.projectGitRefreshKeys[normalizedProjectId] ?? 0) + 1,
      },
    }));
  },

  bumpProjectFilesRefreshKey: (projectId) => {
    const normalizedProjectId =
      typeof projectId === "string" ? projectId.trim() : "";
    if (!normalizedProjectId) {
      return;
    }

    set((state) => ({
      projectFilesRefreshKeys: {
        ...state.projectFilesRefreshKeys,
        [normalizedProjectId]:
          (state.projectFilesRefreshKeys[normalizedProjectId] ?? 0) + 1,
      },
    }));
  },

  setIsMacOs: (value) => set({ isMacOs: value }),

  setIsElectron: (value) => set({ isElectron: value }),

  setAppReady: (value) => set({ appReady: value }),

  openExternalUrl: (url) => {
    const desktopApi = getDesktopApi();
    if (desktopApi) {
      void desktopApi.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  openExternalPath: (path) => {
    const desktopApi = getDesktopApi();
    if (desktopApi) {
      void desktopApi.openPath(path);
    }
  },
});
