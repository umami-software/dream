import type { UIMessage } from "ai";
import type { StoreApi } from "zustand";
import type {
  AiProvider,
  AppSettings,
  BrowserTabState,
  ChatConfig,
  ChatSortOrder,
  PanelSizes,
  PanelVisibility,
  PendingChatSubmit,
  ProjectConfig,
  RightPanelView,
  StashItem,
} from "@/types/ide";
import type { ProviderModelState, SettingsSection } from "../ide-types";

export interface WorktreeInitialChatSeed {
  messageId: string;
  messages: UIMessage[];
  sourceChat: ChatConfig;
}

export interface WorktreeProjectCreationResult {
  chatId: string | null;
  projectId: string;
}

export interface AddProjectTerminalOptions {
  command?: string;
  cwd?: string;
  name?: string;
  strictCwd?: boolean;
}

export interface IdeState {
  // Persisted state
  projects: ProjectConfig[];
  closedProjects: ProjectConfig[];
  activeProjectId: string | null;
  chats: ChatConfig[];
  chatSort: ChatSortOrder;
  settings: AppSettings;
  messagesByChatId: Record<string, UIMessage[]>;
  pendingChatSubmitByChatId: Record<string, PendingChatSubmit>;

  // Runtime state
  streamingChatIds: Record<string, boolean>;
  awaitingAnswerChatIds: Record<string, boolean>;
  completedChatIds: Record<string, boolean>;
  titleGeneratingChatIds: Record<string, boolean>;
  draftChatIdByProject: Record<string, string | null>;
  terminalStatus: Record<string, "running" | "stopped">;
  terminalTransport: Record<string, "pty" | "pipe">;
  terminalShell: Record<string, string>;
  terminalSessionNames: Record<string, string>;
  nextTerminalOrdinalByProject: Record<string, number>;
  projectTerminalSessionIds: Record<string, string[]>;
  activeTerminalSessionIdByProject: Record<string, string | null>;
  projectTerminalPanelOpenByProject: Record<string, boolean>;
  outputPanelOpen: boolean;
  browserError: string | null;
  browserLoading: Record<string, boolean>;
  browserTabsByProject: Record<string, BrowserTabState[]>;
  activeBrowserTabIdByProject: Record<string, string | null>;
  projectGitRefreshKeys: Record<string, number>;
  projectFilesRefreshKeys: Record<string, number>;
  projectFileOpenRequests: Record<
    string,
    { filePath: string; requestId: number }
  >;
  stateHydrated: boolean;
  isMacOs: boolean;
  isElectron: boolean;
  appReady: boolean;

  // Settings dialog state
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  modelSearchQuery: string;
  providerModels: {
    openai: ProviderModelState;
    anthropic: ProviderModelState;
    opencode: ProviderModelState;
    cursor: ProviderModelState;
    grok: ProviderModelState;
    fetchedAt: string | null;
  };

  // Derived
  getActiveProject: () => ProjectConfig | null;
  getChatsForProject: (projectId: string) => ChatConfig[];
  getActiveChat: () => ChatConfig | null;
  getBrowserTabs: (projectId: string | null | undefined) => BrowserTabState[];
  getActiveBrowserTab: (projectId?: string | null) => BrowserTabState | null;

  // Actions - projects
  setProjects: (projects: ProjectConfig[]) => void;
  setActiveProjectId: (id: string | null) => void;
  addProject: (path: string) => void;
  createWorktreeProject: (
    parentProjectId: string,
    options: {
      baseRef?: string | null;
      branchName: string;
      initialChatSeed?: WorktreeInitialChatSeed;
    },
  ) => Promise<WorktreeProjectCreationResult | null>;
  closeProject: (projectId: string) => void;
  updateProject: (
    projectId: string,
    updater: (project: ProjectConfig) => ProjectConfig,
  ) => void;
  addChat: (
    projectId: string,
    title?: string,
    options?: { forceNew?: boolean },
  ) => string | null;
  addChatBeside: (projectId: string) => string | null;
  branchChatInWorkspace: (options: {
    chatId: string;
    messageId: string;
  }) => string;
  branchChatInNewWorktree: (options: {
    baseRef?: string | null;
    branchName: string;
    chatId: string;
    messageId: string;
  }) => Promise<{ chatId: string; projectId: string }>;
  toggleProjectMultiChatMode: (projectId: string) => void;
  setActiveChatId: (projectId: string, chatId: string | null) => void;
  updateChat: (
    chatId: string,
    updater: (chat: ChatConfig) => ChatConfig,
  ) => void;
  archiveInactiveChats: () => number;
  deleteChat: (chatId: string) => void;
  permanentlyDeleteChats: (chatIds: string[]) => void;
  restoreChats: (chatIds: string[]) => void;
  setMessagesForChat: (chatId: string, messages: UIMessage[]) => void;
  loadMessagesForChat: (chatId: string) => Promise<UIMessage[]>;
  persistMessagesForChat: (
    chatId: string,
    messages?: UIMessage[],
  ) => Promise<void>;
  setChatSort: (sortOrder: ChatSortOrder) => void;
  addStashItem: (
    projectId: string,
    item: Omit<StashItem, "createdAt" | "id" | "updatedAt">,
  ) => string | null;
  updateStashItem: (
    projectId: string,
    itemId: string,
    updater: (item: StashItem) => StashItem,
  ) => void;
  deleteStashItem: (projectId: string, itemId: string) => void;
  executeStashItem: (projectId: string, itemId: string) => string | null;
  queueChatSubmit: (chatId: string, submission: PendingChatSubmit) => boolean;
  takePendingChatSubmit: (chatId: string) => PendingChatSubmit | null;

  // Actions - panels
  togglePanel: (panel: keyof PanelVisibility) => void;
  setPanelSizes: (
    updater: PanelSizes | ((prev: PanelSizes) => PanelSizes),
  ) => void;
  setProjectPanelSizes: (
    projectId: string,
    updater: PanelSizes | ((prev: PanelSizes) => PanelSizes),
  ) => void;
  setProjectChatHistoryPanelOpen: (projectId: string, open: boolean) => void;
  setProjectRightPanelOpen: (projectId: string, open: boolean) => void;
  setProjectRightPanelView: (projectId: string, view: RightPanelView) => void;
  openProjectFile: (projectId: string, filePath: string) => void;
  setOutputPanelOpen: (open: boolean) => void;

  // Actions - settings
  setSettings: (
    updater: AppSettings | ((prev: AppSettings) => AppSettings),
  ) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setModelSearchQuery: (query: string) => void;

  // Actions - provider management
  toggleProviderModel: (
    provider: AiProvider,
    model: string,
    enabled?: boolean,
  ) => void;
  refreshProviderModels: (options?: {
    force?: boolean;
    provider?: AiProvider;
  }) => Promise<void>;
  setProviderModels: (
    updater:
      | IdeState["providerModels"]
      | ((prev: IdeState["providerModels"]) => IdeState["providerModels"]),
  ) => void;

  // Actions - runtime
  setTerminalStatus: (projectId: string, status: "running" | "stopped") => void;
  setTerminalTransport: (projectId: string, transport: "pty" | "pipe") => void;
  setTerminalShell: (projectId: string, shell: string) => void;
  setTerminalSessionName: (sessionId: string, name: string) => void;
  setChatStreaming: (chatId: string, streaming: boolean) => void;
  setChatAwaitingAnswer: (chatId: string, awaiting: boolean) => void;
  setChatTitleGenerating: (chatId: string, generating: boolean) => void;
  bumpProjectGitRefreshKey: (projectId: string) => void;
  bumpProjectFilesRefreshKey: (projectId: string) => void;
  setBrowserError: (error: string | null) => void;
  setBrowserLoading: (id: string, loading: boolean) => void;
  ensureBrowserTabs: (projectId: string, initialUrl?: string) => void;
  createBrowserTab: (projectId: string, initialUrl?: string) => string | null;
  updateBrowserTab: (
    projectId: string,
    tabId: string,
    updater: (tab: BrowserTabState) => BrowserTabState,
  ) => void;
  closeBrowserTab: (projectId: string, tabId: string) => string | null;
  reorderBrowserTabs: (
    projectId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  setActiveBrowserTab: (projectId: string, tabId: string | null) => void;
  setIsMacOs: (value: boolean) => void;
  setIsElectron: (value: boolean) => void;
  setAppReady: (value: boolean) => void;
  openExternalUrl: (url: string) => void;
  openExternalPath: (path: string) => void;

  // Actions - runner
  startRunner: () => Promise<void>;
  stopRunner: () => Promise<void>;

  // Actions - terminal
  openProjectTerminal: (projectId: string) => Promise<void>;
  setProjectTerminalPanelOpen: (projectId: string, open: boolean) => void;
  addProjectTerminal: (
    projectId: string,
    options?: AddProjectTerminalOptions,
  ) => Promise<void>;
  setActiveProjectTerminalId: (
    projectId: string,
    sessionId: string | null,
  ) => void;
  reorderProjectTerminals: (
    projectId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  closeProjectTerminal: (projectId: string, sessionId: string) => Promise<void>;

  // Actions - hydration & persistence
  hydrate: () => Promise<void>;
  persist: () => void;
}

export type IdeStoreSet = StoreApi<IdeState>["setState"];
export type IdeStoreGet = StoreApi<IdeState>["getState"];
