import { getDesktopApi } from "@/lib/electron";
import {
  createChatConfig,
  createProjectConfig,
  getDefaultModelSelection,
} from "@/lib/ide-defaults";
import type {
  ProjectConfig,
  ProjectGitCreateWorktreeResponse,
  ProjectGitWorktreeCleanupResponse,
} from "@/types/ide";
import { createBranchedChatConfig } from "../chat-branching";
import {
  ensureActiveChatForProject,
  ensureActiveProject,
  normalizeProjectPathKey,
  sanitizeProjectUiForChats,
} from "../ide-state";
import { deleteTerminalScrollback } from "../terminal-scrollback";
import { updateProjectInList, updateProjectUiInList } from ".";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";

export const isMissingWorktreeError = (message: string) =>
  message.toLowerCase().includes("worktree was not found");

const touchProjectInList = (
  projects: ProjectConfig[],
  projectId: string,
  lastUsedAt: string,
) =>
  updateProjectInList(projects, projectId, (project) => ({
    ...project,
    lastUsedAt,
  }));

export const createProjectLifecycleActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
): Pick<
  IdeState,
  | "setProjects"
  | "setActiveProjectId"
  | "addProject"
  | "createWorktreeProject"
  | "closeProject"
  | "stopProjectTerminals"
  | "purgeWorktreeProject"
  | "removeWorktreeProject"
  | "updateProject"
> => ({
  setProjects: (projects: ProjectConfig[]) => {
    set((state) => {
      const nextActiveProjectId =
        state.activeProjectId === null
          ? null
          : ensureActiveProject(projects, state.activeProjectId);
      let nextChats = state.chats;
      let nextMessagesByChatId = state.messagesByChatId;
      const nextProjects = projects.map((project) => {
        let nextActiveChatId = ensureActiveChatForProject(
          nextChats,
          project.id,
          project.ui.activeChatId,
        );

        if (!nextActiveChatId) {
          const defaultSelection = getDefaultModelSelection(state.settings);
          const nextChat = createChatConfig(project, {
            model: defaultSelection.model || project.model,
            provider: defaultSelection.model
              ? defaultSelection.provider
              : project.provider,
          });
          nextChats = [...nextChats, nextChat];
          nextMessagesByChatId = {
            ...nextMessagesByChatId,
            [nextChat.id]: [],
          };
          nextActiveChatId = nextChat.id;
        }

        return {
          ...project,
          ui: sanitizeProjectUiForChats(
            nextChats,
            project.id,
            project.ui,
            nextActiveChatId,
          ),
        };
      });

      return {
        activeProjectId: nextActiveProjectId,
        chats: nextChats,
        messagesByChatId: nextMessagesByChatId,
        projects: nextProjects,
      };
    });
  },

  setActiveProjectId: (id: string | null) => {
    set((state) => {
      if (id === null) {
        return state.activeProjectId === null
          ? state
          : {
              activeProjectId: null,
            };
      }

      const nextActiveProjectId = ensureActiveProject(state.projects, id);
      const lastUsedAt = new Date().toISOString();
      const nextCompletedChatIds = { ...state.completedChatIds };
      if (nextActiveProjectId) {
        for (const chat of state.chats) {
          if (chat.projectId === nextActiveProjectId) {
            delete nextCompletedChatIds[chat.id];
          }
        }
      }
      const completedChatIdsChanged =
        Object.keys(nextCompletedChatIds).length !==
        Object.keys(state.completedChatIds).length;

      if (
        nextActiveProjectId === state.activeProjectId &&
        !completedChatIdsChanged
      ) {
        return state;
      }

      return {
        activeProjectId: nextActiveProjectId,
        completedChatIds: nextCompletedChatIds,
        projects: nextActiveProjectId
          ? touchProjectInList(state.projects, nextActiveProjectId, lastUsedAt)
          : state.projects,
      };
    });
  },

  addProject: (path: string) => {
    set((state) => {
      const pathKey = normalizeProjectPathKey(path);
      const lastUsedAt = new Date().toISOString();
      const openProject = state.projects.find(
        (project) => normalizeProjectPathKey(project.path) === pathKey,
      );
      if (openProject) {
        let nextChats = state.chats;
        let nextMessagesByChatId = state.messagesByChatId;
        let nextActiveChatId = ensureActiveChatForProject(
          nextChats,
          openProject.id,
          openProject.ui.activeChatId,
        );

        if (!nextActiveChatId) {
          const defaultSelection = getDefaultModelSelection(state.settings);
          const nextChat = createChatConfig(openProject, {
            model: defaultSelection.model || openProject.model,
            provider: defaultSelection.model
              ? defaultSelection.provider
              : openProject.provider,
          });
          nextChats = [...nextChats, nextChat];
          nextMessagesByChatId = {
            ...nextMessagesByChatId,
            [nextChat.id]: [],
          };
          nextActiveChatId = nextChat.id;
        }
        return {
          activeProjectId: openProject.id,
          chats: nextChats,
          messagesByChatId: nextMessagesByChatId,
          projects: updateProjectUiInList(
            touchProjectInList(state.projects, openProject.id, lastUsedAt),
            openProject.id,
            (project) =>
              sanitizeProjectUiForChats(
                nextChats,
                openProject.id,
                project.ui,
                nextActiveChatId,
              ),
          ),
        };
      }

      const closedProject = state.closedProjects.find(
        (project) => normalizeProjectPathKey(project.path) === pathKey,
      );
      if (closedProject) {
        const reopenedProject = { ...closedProject, lastUsedAt, path };
        let nextChats = state.chats;
        let nextMessagesByChatId = state.messagesByChatId;
        let nextActiveChatId = ensureActiveChatForProject(
          nextChats,
          reopenedProject.id,
          reopenedProject.ui.activeChatId,
        );

        if (!nextActiveChatId) {
          const nextChat = createChatConfig(reopenedProject);
          nextChats = [...nextChats, nextChat];
          nextMessagesByChatId = {
            ...nextMessagesByChatId,
            [nextChat.id]: [],
          };
          nextActiveChatId = nextChat.id;
        }

        return {
          activeProjectId: reopenedProject.id,
          closedProjects: state.closedProjects.filter(
            (project) =>
              normalizeProjectPathKey(project.path) !== pathKey &&
              project.id !== reopenedProject.id,
          ),
          messagesByChatId: nextMessagesByChatId,
          chats: nextChats,
          projects: [
            ...state.projects,
            {
              ...reopenedProject,
              ui: sanitizeProjectUiForChats(
                nextChats,
                reopenedProject.id,
                reopenedProject.ui,
                nextActiveChatId,
              ),
            },
          ],
        };
      }

      const nextProject = createProjectConfig(path, state.settings);
      const nextChat = createChatConfig(nextProject);

      return {
        activeProjectId: nextProject.id,
        draftChatIdByProject: {
          ...state.draftChatIdByProject,
          [nextProject.id]: nextChat.id,
        },
        messagesByChatId: {
          ...state.messagesByChatId,
          [nextChat.id]: [],
        },
        chats: [...state.chats, nextChat],
        projects: [
          ...state.projects,
          {
            ...nextProject,
            ui: {
              ...nextProject.ui,
              activeChatId: nextChat.id,
              openChatIds: [nextChat.id],
              chatColumnWidths: {},
            },
          },
        ],
      };
    });
  },

  createWorktreeProject: async (
    parentProjectId: string,
    options: {
      baseRef?: string | null;
      branchName: string;
      initialChatSeed?: import("./ide-store-types").WorktreeInitialChatSeed;
    },
  ) => {
    const parentProject = get().projects.find(
      (project) => project.id === parentProjectId,
    );
    if (!parentProject) {
      throw new Error();
    }

    const response = await fetch("/api/project-git-worktree-create", {
      body: JSON.stringify({
        baseRef: options.baseRef ?? null,
        branchName: options.branchName,
        projectPath: parentProject.path,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        text.trim() || response.statusText || String(response.status),
      );
    }

    const payload = (await response.json()) as ProjectGitCreateWorktreeResponse;
    let createdProjectId: string | null = null;
    let createdChatId: string | null = null;

    set((state) => {
      const pathKey = normalizeProjectPathKey(payload.path);
      const existingProject = state.projects.find(
        (project) => normalizeProjectPathKey(project.path) === pathKey,
      );
      if (existingProject) {
        createdProjectId = existingProject.id;
        const lastUsedAt = new Date().toISOString();
        const nextChat = options.initialChatSeed
          ? createBranchedChatConfig(
              options.initialChatSeed.sourceChat,
              existingProject,
              options.initialChatSeed.messageId,
            )
          : null;
        if (nextChat) {
          nextChat.messageCount = options.initialChatSeed?.messages.length ?? 0;
        }
        createdChatId = nextChat?.id ?? existingProject.ui.activeChatId;
        return {
          activeProjectId: existingProject.id,
          chats: nextChat ? [...state.chats, nextChat] : state.chats,
          messagesByChatId: nextChat
            ? {
                ...state.messagesByChatId,
                [nextChat.id]: options.initialChatSeed?.messages ?? [],
              }
            : state.messagesByChatId,
          projects: touchProjectInList(
            nextChat
              ? updateProjectUiInList(
                  state.projects,
                  existingProject.id,
                  (project) => ({
                    ...project.ui,
                    activeChatId: nextChat.id,
                    openChatIds: [nextChat.id],
                    chatColumnWidths: {},
                  }),
                )
              : state.projects,
            existingProject.id,
            lastUsedAt,
          ),
        };
      }

      const closedProject = state.closedProjects.find(
        (project) => normalizeProjectPathKey(project.path) === pathKey,
      );
      if (closedProject) {
        createdProjectId = closedProject.id;
        const lastUsedAt = new Date().toISOString();
        const reopenedProject = {
          ...closedProject,
          lastUsedAt,
          path: payload.path,
          worktree: {
            baseRef: payload.baseRef,
            branch: payload.branch,
            createdAt: new Date().toISOString(),
            kind: "worktree" as const,
            mainWorktreePath: payload.mainWorktreePath,
            managed: true,
            parentProjectId,
            repoRoot: payload.repoRoot,
          },
        };
        const nextChat = options.initialChatSeed
          ? createBranchedChatConfig(
              options.initialChatSeed.sourceChat,
              reopenedProject,
              options.initialChatSeed.messageId,
            )
          : null;
        if (nextChat) {
          nextChat.messageCount = options.initialChatSeed?.messages.length ?? 0;
        }
        createdChatId = nextChat?.id ?? reopenedProject.ui.activeChatId;
        return {
          activeProjectId: closedProject.id,
          chats: nextChat ? [...state.chats, nextChat] : state.chats,
          closedProjects: state.closedProjects.filter(
            (project) => project.id !== closedProject.id,
          ),
          messagesByChatId: nextChat
            ? {
                ...state.messagesByChatId,
                [nextChat.id]: options.initialChatSeed?.messages ?? [],
              }
            : state.messagesByChatId,
          projects: [
            ...state.projects,
            {
              ...reopenedProject,
              ui: nextChat
                ? {
                    ...reopenedProject.ui,
                    activeChatId: nextChat.id,
                    openChatIds: [nextChat.id],
                    chatColumnWidths: {},
                  }
                : reopenedProject.ui,
            },
          ],
        };
      }

      const nextProject = {
        ...createProjectConfig(payload.path, state.settings),
        browserUrl: parentProject.browserUrl,
        model: parentProject.model,
        modelSpeed: parentProject.modelSpeed,
        name: `${parentProject.name} / ${payload.branch}`,
        provider: parentProject.provider,
        reasoningEffort: parentProject.reasoningEffort,
        runCommand: parentProject.runCommand,
        worktree: {
          baseRef: payload.baseRef,
          branch: payload.branch,
          createdAt: new Date().toISOString(),
          kind: "worktree" as const,
          mainWorktreePath: payload.mainWorktreePath,
          managed: true,
          parentProjectId,
          repoRoot: payload.repoRoot,
        },
      };
      const nextChat = options.initialChatSeed
        ? createBranchedChatConfig(
            options.initialChatSeed.sourceChat,
            nextProject,
            options.initialChatSeed.messageId,
          )
        : createChatConfig(nextProject);
      nextChat.messageCount = options.initialChatSeed?.messages.length ?? 0;
      createdProjectId = nextProject.id;
      createdChatId = nextChat.id;

      return {
        activeProjectId: nextProject.id,
        draftChatIdByProject: {
          ...state.draftChatIdByProject,
          [nextProject.id]: options.initialChatSeed ? null : nextChat.id,
        },
        messagesByChatId: {
          ...state.messagesByChatId,
          [nextChat.id]: options.initialChatSeed?.messages ?? [],
        },
        chats: [...state.chats, nextChat],
        projects: [
          ...state.projects,
          {
            ...nextProject,
            ui: {
              ...nextProject.ui,
              activeChatId: nextChat.id,
              openChatIds: [nextChat.id],
              chatColumnWidths: {},
              rightPanelView: "changes",
            },
          },
        ],
      };
    });

    if (createdChatId && options.initialChatSeed) {
      await get().persistMessagesForChat?.(createdChatId);
    }

    return createdProjectId
      ? { chatId: createdChatId, projectId: createdProjectId }
      : null;
  },

  stopProjectTerminals: (projectId: string) => {
    const terminalSessionIds =
      get().projectTerminalSessionIds?.[projectId] ?? [];
    const desktopApi = getDesktopApi();
    for (const sessionId of terminalSessionIds) {
      void desktopApi?.stopTerminal(sessionId);
      deleteTerminalScrollback(sessionId);
    }
  },

  purgeWorktreeProject: (
    worktreePath: string,
    options: { activateProjectId?: string | null } = {},
  ) => {
    const worktreePathKey = normalizeProjectPathKey(worktreePath);
    const openProject = get().projects.find(
      (item) => normalizeProjectPathKey(item.path) === worktreePathKey,
    );
    if (openProject) {
      get().closeProject(openProject.id);
    }

    set((current) => {
      const removedProjectIds = new Set(
        [...current.projects, ...current.closedProjects]
          .filter(
            (item) => normalizeProjectPathKey(item.path) === worktreePathKey,
          )
          .map((item) => item.id),
      );
      if (removedProjectIds.size === 0) {
        return current;
      }

      const removedChatIds = new Set(
        current.chats
          .filter((chat) => removedProjectIds.has(chat.projectId))
          .map((chat) => chat.id),
      );
      const messagesByChatId = { ...current.messagesByChatId };
      for (const chatId of removedChatIds) {
        delete messagesByChatId[chatId];
      }

      return {
        chats: current.chats.filter(
          (chat) => !removedProjectIds.has(chat.projectId),
        ),
        closedProjects: current.closedProjects.filter(
          (item) => normalizeProjectPathKey(item.path) !== worktreePathKey,
        ),
        messagesByChatId,
        projects: current.projects.filter(
          (item) => normalizeProjectPathKey(item.path) !== worktreePathKey,
        ),
      };
    });

    const activateProjectId = options.activateProjectId ?? null;
    if (
      activateProjectId &&
      get().projects.some((project) => project.id === activateProjectId)
    ) {
      get().setActiveProjectId(activateProjectId);
      get().bumpProjectGitRefreshKey?.(activateProjectId);
    }
  },

  removeWorktreeProject: async ({
    deleteBranch = false,
    force = false,
    mainWorktreePath,
    parentProjectId = null,
    worktreePath,
  }) => {
    const worktreePathKey = normalizeProjectPathKey(worktreePath);
    const openProject = get().projects.find(
      (item) => normalizeProjectPathKey(item.path) === worktreePathKey,
    );
    if (openProject) {
      get().stopProjectTerminals(openProject.id);
    }

    const response = await fetch("/api/project-git-worktree-cleanup", {
      body: JSON.stringify({
        deleteBranch,
        force,
        projectPath: mainWorktreePath,
        worktreePath,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      const message =
        text.trim() || response.statusText || String(response.status);
      if (!isMissingWorktreeError(message)) {
        throw new Error(message);
      }

      get().purgeWorktreeProject(worktreePath, {
        activateProjectId: parentProjectId,
      });
      return null;
    }

    const payload =
      (await response.json()) as ProjectGitWorktreeCleanupResponse;
    get().purgeWorktreeProject(worktreePath, {
      activateProjectId: parentProjectId,
    });
    return payload;
  },

  closeProject: (projectId: string) => {
    const terminalSessionIds =
      get().projectTerminalSessionIds?.[projectId] ?? [];
    get().stopProjectTerminals(projectId);

    set((state) => {
      const closedProject = state.projects.find(
        (project) => project.id === projectId,
      );
      const closedAt = new Date().toISOString();
      const nextProjects = state.projects.filter(
        (project) => project.id !== projectId,
      );
      const nextActiveProjectId = ensureActiveProject(
        nextProjects,
        state.activeProjectId === projectId ? null : state.activeProjectId,
      );
      const closedProjectPathKey = closedProject
        ? normalizeProjectPathKey(closedProject.path)
        : null;
      const nextClosedProjects = closedProject
        ? [
            ...state.closedProjects.filter(
              (project) =>
                project.id !== closedProject.id &&
                normalizeProjectPathKey(project.path) !== closedProjectPathKey,
            ),
            closedProject,
          ]
        : state.closedProjects;
      const nextProjectGitRefreshKeys = { ...state.projectGitRefreshKeys };
      const nextProjectFilesRefreshKeys = {
        ...state.projectFilesRefreshKeys,
      };
      const nextProjectFileOpenRequests = {
        ...state.projectFileOpenRequests,
      };
      const nextTerminalOrdinalByProject = {
        ...state.nextTerminalOrdinalByProject,
      };
      const nextTerminalStatus = { ...state.terminalStatus };
      const nextTerminalTransport = { ...state.terminalTransport };
      const nextTerminalShell = { ...state.terminalShell };
      const nextTerminalSessionNames = { ...state.terminalSessionNames };
      const nextProjectTerminalSessionIds = {
        ...state.projectTerminalSessionIds,
      };
      const nextActiveTerminalSessionIdByProject = {
        ...state.activeTerminalSessionIdByProject,
      };
      const nextProjectTerminalPanelOpenByProject = {
        ...state.projectTerminalPanelOpenByProject,
      };
      const nextBrowserLoading = { ...state.browserLoading };
      const nextDraftChatIdByProject = { ...state.draftChatIdByProject };
      const browserTabs = state.browserTabsByProject[projectId] ?? [];

      delete nextProjectGitRefreshKeys[projectId];
      delete nextProjectFilesRefreshKeys[projectId];
      delete nextProjectFileOpenRequests[projectId];
      delete nextTerminalOrdinalByProject[projectId];
      delete nextProjectTerminalSessionIds[projectId];
      delete nextActiveTerminalSessionIdByProject[projectId];
      delete nextProjectTerminalPanelOpenByProject[projectId];
      delete nextDraftChatIdByProject[projectId];
      for (const tab of browserTabs) {
        delete nextBrowserLoading[tab.id];
      }
      for (const sessionId of terminalSessionIds) {
        delete nextTerminalStatus[sessionId];
        delete nextTerminalTransport[sessionId];
        delete nextTerminalShell[sessionId];
        delete nextTerminalSessionNames[sessionId];
      }
      const nextOpenProjects = nextProjects.map((project) => ({
        ...project,
        ui: sanitizeProjectUiForChats(
          state.chats,
          project.id,
          project.ui,
          ensureActiveChatForProject(
            state.chats,
            project.id,
            project.ui.activeChatId,
          ),
        ),
      }));
      const nextClosedProject = closedProject
        ? {
            ...closedProject,
            lastUsedAt: closedAt,
            ui: sanitizeProjectUiForChats(
              state.chats,
              projectId,
              closedProject.ui,
              ensureActiveChatForProject(
                state.chats,
                projectId,
                closedProject.ui.activeChatId,
              ),
            ),
          }
        : null;
      const nextClosedProjectsWithUi = nextClosedProject
        ? [
            ...state.closedProjects.filter(
              (project) =>
                project.id !== nextClosedProject.id &&
                normalizeProjectPathKey(project.path) !== closedProjectPathKey,
            ),
            nextClosedProject,
          ]
        : nextClosedProjects;

      return {
        activeProjectId: nextActiveProjectId,
        closedProjects: nextClosedProjectsWithUi,
        nextTerminalOrdinalByProject,
        terminalStatus: nextTerminalStatus,
        terminalTransport: nextTerminalTransport,
        terminalShell: nextTerminalShell,
        terminalSessionNames: nextTerminalSessionNames,
        projectTerminalSessionIds: nextProjectTerminalSessionIds,
        activeTerminalSessionIdByProject: nextActiveTerminalSessionIdByProject,
        projectTerminalPanelOpenByProject:
          nextProjectTerminalPanelOpenByProject,
        browserLoading: nextBrowserLoading,
        draftChatIdByProject: nextDraftChatIdByProject,
        projectGitRefreshKeys: nextProjectGitRefreshKeys,
        projectFilesRefreshKeys: nextProjectFilesRefreshKeys,
        projectFileOpenRequests: nextProjectFileOpenRequests,
        projects: nextOpenProjects,
      };
    });
  },

  updateProject: (
    projectId: string,
    updater: (project: ProjectConfig) => ProjectConfig,
  ) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? updater(project) : project,
      ),
    }));
  },
});
