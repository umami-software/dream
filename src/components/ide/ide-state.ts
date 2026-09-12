import type {
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
} from "ai";
import { normalizeLocalePreference } from "@/i18n/config";
import {
  createChatConfig,
  DEFAULT_PANEL_SIZES,
  DEFAULT_PANEL_VISIBILITY,
  DEFAULT_PROJECT_UI,
  DEFAULT_PROVIDER,
  DEFAULT_SETTINGS,
  getDefaultModelSelection,
  getPreferredDefaultModel,
  normalizeClaudeCodeModelId,
} from "@/lib/ide-defaults";
import { normalizeSparklesPaletteName } from "@/lib/sparkles-palettes";
import type {
  AgentMode,
  AiProvider,
  AppSettings,
  BrowserTabState,
  ChatConfig,
  ChatPermissionMode,
  PersistedIdeState,
  ProjectConfig,
  ProjectReference,
  ProjectUiState,
  ProjectWorktreeInfo,
  RightPanelView,
  StashItem,
} from "@/types/ide";
import {
  dedupeModels,
  normalizeModelSpeed,
  normalizeReasoningEffort,
} from "./ide-types";

export const emptyState: PersistedIdeState = {
  activeProjectId: null,
  activeBrowserTabIdByProject: {},
  browserTabsByProject: {},
  chats: [],
  closedProjects: [],
  messagesByChatId: {},
  projects: [],
  settings: DEFAULT_SETTINGS,
  chatSort: "recent",
};

type LegacyPersistedIdeState = Partial<PersistedIdeState> & {
  activeChatIdByProject?: Record<string, string | null>;
  activeThreadIdByProject?: Record<string, string | null>;
  panelSizes?: unknown;
  panelVisibility?: Partial<{ left: boolean; middle: boolean; right: boolean }>;
  projectPanelSizesByProject?: Record<string, unknown>;
  projectRightPanelOpenByProject?: Record<string, unknown>;
  projectRightPanelViewByProject?: Record<string, unknown>;
};

export const normalizeProjectPathKey = (path: string): string => {
  const trimmed = path.trim();
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "") || trimmed;
  const normalized = withoutTrailingSeparators.replace(/\\/g, "/");
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalized) || path.includes("\\");

  return isWindowsPath ? normalized.toLowerCase() : normalized;
};

export const areProjectsEqualExceptLastUsedAt = (
  previous: ProjectConfig,
  next: ProjectConfig,
) => {
  if (previous === next) {
    return true;
  }

  const previousKeys = Object.keys(previous).filter(
    (key) => key !== "lastUsedAt",
  ) as Array<keyof ProjectConfig>;
  const nextKeys = Object.keys(next).filter(
    (key) => key !== "lastUsedAt",
  ) as Array<keyof ProjectConfig>;

  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => previous[key] === next[key])
  );
};

export const areProjectListsEqualExceptLastUsedAt = (
  previous: ProjectConfig[],
  next: ProjectConfig[],
) =>
  previous === next ||
  (previous.length === next.length &&
    previous.every(
      (project, index) =>
        next[index] !== undefined &&
        areProjectsEqualExceptLastUsedAt(project, next[index]),
    ));

const isUiMessageArray = (value: unknown): value is UIMessage[] => {
  return Array.isArray(value);
};

const isRightPanelView = (value: unknown): value is RightPanelView =>
  value === "browser" ||
  value === "explorer" ||
  value === "changes" ||
  value === "terminal" ||
  value === "stash";

const isProjectReference = (value: unknown): value is ProjectReference => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const reference = value as Partial<ProjectReference>;
  return (
    (reference.kind === "file" || reference.kind === "folder") &&
    typeof reference.name === "string" &&
    typeof reference.parentPath === "string" &&
    typeof reference.path === "string" &&
    reference.path.trim().length > 0
  );
};

const normalizeStashItem = (value: unknown): StashItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<StashItem>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) {
    return null;
  }

  const createdAt =
    typeof item.createdAt === "string" && item.createdAt.trim().length > 0
      ? item.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof item.updatedAt === "string" && item.updatedAt.trim().length > 0
      ? item.updatedAt
      : createdAt;

  return {
    agentMode: item.agentMode === "plan" ? "plan" : "build",
    createdAt,
    id,
    model: typeof item.model === "string" ? item.model : "",
    modelSpeed: normalizeModelSpeed(item.modelSpeed),
    permissionMode:
      item.permissionMode === "standard" ? "standard" : "full-access",
    provider: normalizeProvider(item.provider),
    reasoningEffort: normalizeReasoningEffort(item.reasoningEffort),
    references: Array.isArray(item.references)
      ? item.references.filter(isProjectReference)
      : [],
    text: typeof item.text === "string" ? item.text : "",
    updatedAt,
  };
};

const normalizeStashItems = (value: unknown): StashItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const items: StashItem[] = [];

  for (const rawItem of value) {
    const item = normalizeStashItem(rawItem);
    if (!item || seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    items.push(item);
  }

  return items;
};

const normalizeBrowserTab = (value: unknown): BrowserTabState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const tab = value as Partial<BrowserTabState>;
  const id = typeof tab.id === "string" ? tab.id.trim() : "";
  if (!id) {
    return null;
  }

  const url = typeof tab.url === "string" ? tab.url.trim() : "";
  const title = typeof tab.title === "string" ? tab.title.trim() : "";
  const zoomFactor =
    typeof tab.zoomFactor === "number" && Number.isFinite(tab.zoomFactor)
      ? tab.zoomFactor
      : 1;

  return {
    canGoBack: tab.canGoBack === true,
    canGoForward: tab.canGoForward === true,
    id,
    title: title || "New Tab",
    url,
    zoomFactor,
  };
};

const normalizeBrowserTabsByProject = (
  value: unknown,
): Record<string, BrowserTabState[]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, BrowserTabState[]> = {};
  for (const [projectId, rawTabs] of Object.entries(value)) {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId || !Array.isArray(rawTabs)) {
      continue;
    }

    const seenTabIds = new Set<string>();
    const tabs = rawTabs
      .map(normalizeBrowserTab)
      .filter((tab): tab is BrowserTabState => {
        if (!tab || seenTabIds.has(tab.id)) {
          return false;
        }
        seenTabIds.add(tab.id);
        return true;
      });

    if (tabs.length > 0) {
      normalized[normalizedProjectId] = tabs;
    }
  }

  return normalized;
};

const normalizeActiveBrowserTabIds = (
  value: unknown,
  browserTabsByProject: Record<string, BrowserTabState[]>,
): Record<string, string | null> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(browserTabsByProject).map(([projectId, tabs]) => [
        projectId,
        tabs[0]?.id ?? null,
      ]),
    );
  }

  const normalized: Record<string, string | null> = {};
  for (const [projectId, tabs] of Object.entries(browserTabsByProject)) {
    const rawActiveTabId = (value as Record<string, unknown>)[projectId];
    const activeTabId =
      typeof rawActiveTabId === "string" ? rawActiveTabId.trim() : "";
    normalized[projectId] = tabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id ?? null);
  }

  return normalized;
};

const normalizePanelSize = (
  value: unknown,
  fallback: number,
  minimum: number,
): number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : fallback;

const normalizePanelSizes = (
  value: unknown,
  fallback = DEFAULT_PANEL_SIZES,
) => {
  const panelSizes = value && typeof value === "object" ? value : {};
  return {
    chatHistoryPanelWidth: Math.min(
      500,
      normalizePanelSize(
        (panelSizes as Partial<typeof DEFAULT_PANEL_SIZES>)
          .chatHistoryPanelWidth,
        fallback.chatHistoryPanelWidth,
        200,
      ),
    ),
    leftSidebarWidth: normalizePanelSize(
      (panelSizes as Partial<typeof DEFAULT_PANEL_SIZES>).leftSidebarWidth,
      fallback.leftSidebarWidth,
      160,
    ),
    rightPanelWidth: normalizePanelSize(
      (panelSizes as Partial<typeof DEFAULT_PANEL_SIZES>).rightPanelWidth,
      fallback.rightPanelWidth,
      200,
    ),
    terminalHeight: normalizePanelSize(
      (panelSizes as Partial<typeof DEFAULT_PANEL_SIZES>).terminalHeight,
      fallback.terminalHeight,
      120,
    ),
  };
};

const normalizeChatIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
};

const normalizeChatColumnWidths = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const widths: Record<string, number> = {};
  for (const [chatId, width] of Object.entries(value)) {
    if (typeof width === "number" && Number.isFinite(width) && width > 0) {
      widths[chatId] = width;
    }
  }

  return widths;
};

const normalizeProvider = (value: unknown): AiProvider => {
  return value === "anthropic" ||
    value === "opencode" ||
    value === "cursor" ||
    value === "grok"
    ? value
    : DEFAULT_PROVIDER;
};

const normalizeProjectIcon = (value: unknown): ProjectConfig["icon"] => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const icon = value as Partial<NonNullable<ProjectConfig["icon"]>>;
  const iconPath = typeof icon.path === "string" ? icon.path.trim() : "";
  if (!iconPath) {
    return null;
  }

  return {
    mimeType:
      typeof icon.mimeType === "string" && icon.mimeType.trim()
        ? icon.mimeType.trim()
        : "application/octet-stream",
    mtimeMs: typeof icon.mtimeMs === "number" ? icon.mtimeMs : 0,
    path: iconPath,
    source:
      typeof icon.source === "string" && icon.source.trim()
        ? icon.source.trim()
        : "unknown",
  };
};

const normalizeProjectLastUsedAt = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed && Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
};

const normalizeProjectWorktree = (
  value: unknown,
): ProjectWorktreeInfo | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const worktree = value as Partial<ProjectWorktreeInfo>;
  const repoRoot =
    typeof worktree.repoRoot === "string" ? worktree.repoRoot.trim() : "";
  const mainWorktreePath =
    typeof worktree.mainWorktreePath === "string"
      ? worktree.mainWorktreePath.trim()
      : "";
  const branch =
    typeof worktree.branch === "string" ? worktree.branch.trim() : "";

  if (
    worktree.kind !== "worktree" ||
    !repoRoot ||
    !mainWorktreePath ||
    !branch
  ) {
    return null;
  }

  return {
    baseRef:
      typeof worktree.baseRef === "string" && worktree.baseRef.trim()
        ? worktree.baseRef.trim()
        : null,
    branch,
    createdAt:
      typeof worktree.createdAt === "string" && worktree.createdAt.trim()
        ? worktree.createdAt
        : new Date().toISOString(),
    kind: "worktree",
    mainWorktreePath,
    managed: worktree.managed === true,
    parentProjectId:
      typeof worktree.parentProjectId === "string" &&
      worktree.parentProjectId.trim()
        ? worktree.parentProjectId.trim()
        : null,
    repoRoot,
  };
};

const normalizeProject = (
  project: ProjectConfig,
  settings: AppSettings,
): ProjectConfig => {
  const rawProject = project as ProjectConfig & {
    metadata?: unknown;
    previewUrl?: unknown;
    ui?: unknown;
  };
  const rawMetadata =
    rawProject.metadata && typeof rawProject.metadata === "object"
      ? (rawProject.metadata as {
          icon?: unknown;
          ui?: unknown;
          worktree?: unknown;
        })
      : {};
  const rawUi =
    rawProject.ui && typeof rawProject.ui === "object"
      ? (rawProject.ui as unknown as Record<string, unknown>)
      : rawMetadata.ui && typeof rawMetadata.ui === "object"
        ? (rawMetadata.ui as Record<string, unknown>)
        : {};
  const rawPanelVisibility =
    rawUi.panelVisibility && typeof rawUi.panelVisibility === "object"
      ? (rawUi.panelVisibility as Record<string, unknown>)
      : {};
  const browserUrl =
    typeof rawProject.browserUrl === "string"
      ? rawProject.browserUrl
      : typeof rawProject.previewUrl === "string"
        ? rawProject.previewUrl
        : "";
  const provider = normalizeProvider(project.provider);
  const model =
    typeof project.model === "string"
      ? provider === "anthropic"
        ? normalizeClaudeCodeModelId(project.model)
        : project.model.trim()
      : "";
  const defaultModel = getPreferredDefaultModel(settings);

  return {
    ...project,
    browserUrl,
    icon: normalizeProjectIcon(rawProject.icon ?? rawMetadata.icon),
    lastUsedAt: normalizeProjectLastUsedAt(
      rawProject.lastUsedAt ??
        (rawMetadata as { lastUsedAt?: unknown }).lastUsedAt,
    ),
    model: model || defaultModel,
    modelSpeed: normalizeModelSpeed(project.modelSpeed),
    provider,
    reasoningEffort: normalizeReasoningEffort(project.reasoningEffort),
    ui: {
      activeChatId:
        typeof rawUi.activeChatId === "string" && rawUi.activeChatId.trim()
          ? rawUi.activeChatId
          : null,
      openChatIds: normalizeChatIds(rawUi.openChatIds),
      chatColumnWidths: normalizeChatColumnWidths(rawUi.chatColumnWidths),
      chatHistoryPanelOpen:
        typeof rawUi.chatHistoryPanelOpen === "boolean"
          ? rawUi.chatHistoryPanelOpen
          : DEFAULT_PROJECT_UI.chatHistoryPanelOpen,
      changesDiffWordWrap:
        typeof rawUi.changesDiffWordWrap === "boolean"
          ? rawUi.changesDiffWordWrap
          : DEFAULT_PROJECT_UI.changesDiffWordWrap,
      fileEditorWordWrap:
        typeof rawUi.fileEditorWordWrap === "boolean"
          ? rawUi.fileEditorWordWrap
          : DEFAULT_PROJECT_UI.fileEditorWordWrap,
      multiChat:
        typeof rawUi.multiChat === "boolean"
          ? rawUi.multiChat
          : DEFAULT_PROJECT_UI.multiChat,
      panelSizes: normalizePanelSizes(rawUi.panelSizes),
      rightPanelOpen:
        typeof rawUi.rightPanelOpen === "boolean"
          ? rawUi.rightPanelOpen
          : typeof rawPanelVisibility.right === "boolean"
            ? rawPanelVisibility.right
            : DEFAULT_PROJECT_UI.rightPanelOpen,
      rightPanelView: isRightPanelView(rawUi.rightPanelView)
        ? rawUi.rightPanelView
        : DEFAULT_PROJECT_UI.rightPanelView,
      stashItems: normalizeStashItems(rawUi.stashItems),
    },
    worktree: normalizeProjectWorktree(
      rawProject.worktree ?? rawMetadata.worktree,
    ),
  };
};

const normalizeChat = (
  chat: ChatConfig,
  projectsById: Map<string, ProjectConfig>,
  legacyPermissionMode: ChatPermissionMode,
): ChatConfig | null => {
  const project = projectsById.get(chat.projectId);
  if (!project) {
    return null;
  }

  const title = typeof chat.title === "string" ? chat.title.trim() : "";
  const createdAt =
    typeof chat.createdAt === "string" && chat.createdAt.trim().length > 0
      ? chat.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof chat.updatedAt === "string" && chat.updatedAt.trim().length > 0
      ? chat.updatedAt
      : createdAt;
  const provider = normalizeProvider(chat.provider);
  const model =
    typeof chat.model === "string"
      ? provider === "anthropic"
        ? normalizeClaudeCodeModelId(chat.model)
        : chat.model.trim()
      : project.model;
  const rawChat = chat as ChatConfig & {
    branchedFrom?: unknown;
    deletedAt?: unknown;
    metadata?: unknown;
    messageCount?: unknown;
    permissionMode?: unknown;
    sparklesPalette?: unknown;
  };
  const rawMetadata =
    rawChat.metadata && typeof rawChat.metadata === "object"
      ? (rawChat.metadata as {
          branchedFrom?: unknown;
          permissions?: { mode?: unknown };
          sparklesPalette?: unknown;
        })
      : {};
  const rawBranchedFrom =
    rawChat.branchedFrom ?? rawMetadata.branchedFrom ?? null;
  const branchedFrom =
    rawBranchedFrom &&
    typeof rawBranchedFrom === "object" &&
    typeof (rawBranchedFrom as { chatId?: unknown }).chatId === "string" &&
    (rawBranchedFrom as { chatId: string }).chatId.trim() &&
    typeof (rawBranchedFrom as { messageId?: unknown }).messageId ===
      "string" &&
    (rawBranchedFrom as { messageId: string }).messageId.trim()
      ? {
          chatId: (rawBranchedFrom as { chatId: string }).chatId,
          messageId: (rawBranchedFrom as { messageId: string }).messageId,
        }
      : null;
  const deletedAt =
    typeof rawChat.deletedAt === "string" && rawChat.deletedAt.trim().length > 0
      ? rawChat.deletedAt
      : null;
  const agentMode: AgentMode = chat.agentMode === "plan" ? "plan" : "build";

  return {
    agentMode,
    branchedFrom,
    createdAt,
    deletedAt,
    ...(rawChat.metadata && typeof rawChat.metadata === "object"
      ? { metadata: rawChat.metadata }
      : {}),
    id: chat.id,
    messageCount:
      typeof rawChat.messageCount === "number" &&
      Number.isInteger(rawChat.messageCount) &&
      rawChat.messageCount >= 0
        ? rawChat.messageCount
        : 0,
    model: model || project.model,
    modelSpeed: normalizeModelSpeed(chat.modelSpeed),
    permissionMode:
      rawChat.permissionMode === "full-access" ||
      rawChat.permissionMode === "standard"
        ? rawChat.permissionMode
        : rawMetadata.permissions?.mode === "full-access" ||
            rawMetadata.permissions?.mode === "standard"
          ? rawMetadata.permissions.mode
          : legacyPermissionMode,
    projectId: chat.projectId,
    provider,
    reasoningEffort: normalizeReasoningEffort(chat.reasoningEffort),
    remoteConversationId:
      typeof chat.remoteConversationId === "string" &&
      chat.remoteConversationId.trim().length > 0
        ? chat.remoteConversationId
        : null,
    remoteConversationModel:
      typeof chat.remoteConversationModel === "string" &&
      chat.remoteConversationModel.trim().length > 0
        ? chat.remoteConversationModel
        : null,
    remoteConversationModelSpeed:
      typeof chat.remoteConversationModelSpeed === "string" &&
      chat.remoteConversationModelSpeed.trim().length > 0
        ? normalizeModelSpeed(chat.remoteConversationModelSpeed)
        : null,
    remoteConversationProjectPath:
      typeof chat.remoteConversationProjectPath === "string" &&
      chat.remoteConversationProjectPath.trim().length > 0
        ? chat.remoteConversationProjectPath
        : null,
    sparklesPalette: normalizeSparklesPaletteName(
      rawChat.sparklesPalette ?? rawMetadata.sparklesPalette,
    ),
    title: title || "New chat",
    updatedAt,
  } as ChatConfig;
};

export const sanitizeProjectUiForChats = (
  chats: ChatConfig[],
  projectId: string,
  ui: ProjectUiState,
  preferredActiveChatId: string | null = ui.activeChatId,
): ProjectUiState => {
  const projectChats = chats.filter(
    (chat) => chat.projectId === projectId && chat.deletedAt === null,
  );
  const availableChatIds = new Set(projectChats.map((chat) => chat.id));
  const activeChatId =
    preferredActiveChatId && availableChatIds.has(preferredActiveChatId)
      ? preferredActiveChatId
      : (projectChats[0]?.id ?? null);
  const openChatIds = ui.openChatIds.filter((chatId) =>
    availableChatIds.has(chatId),
  );

  const nextOpenChatIds = ui.multiChat ? openChatIds : [];
  if (activeChatId) {
    if (ui.multiChat) {
      if (!nextOpenChatIds.includes(activeChatId)) {
        nextOpenChatIds.push(activeChatId);
      }
    } else {
      nextOpenChatIds.splice(0, nextOpenChatIds.length, activeChatId);
    }
  }

  const openChatIdSet = new Set(nextOpenChatIds);
  const chatColumnWidths = Object.fromEntries(
    Object.entries(ui.chatColumnWidths).filter(
      ([chatId, width]) =>
        openChatIdSet.has(chatId) && Number.isFinite(width) && width > 0,
    ),
  );

  return {
    ...ui,
    activeChatId,
    multiChat: ui.multiChat === true,
    openChatIds: nextOpenChatIds,
    chatColumnWidths,
  };
};

export const mergePersistedState = (
  state: Partial<PersistedIdeState> | null | undefined,
): PersistedIdeState => {
  if (!state) {
    return emptyState;
  }

  const legacyState = state as LegacyPersistedIdeState;

  const rawSettings = (state.settings ?? {}) as Partial<AppSettings> &
    Record<string, unknown>;
  const legacyPermissionMode: ChatPermissionMode =
    rawSettings.autoAcceptPermissions === false ? "standard" : "full-access";

  const mergedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    archiveChatsAfterDays:
      typeof rawSettings.archiveChatsAfterDays === "number" &&
      Number.isInteger(rawSettings.archiveChatsAfterDays) &&
      rawSettings.archiveChatsAfterDays > 0
        ? rawSettings.archiveChatsAfterDays
        : typeof rawSettings.autoArchiveChatsAfterDays === "number" &&
            Number.isInteger(rawSettings.autoArchiveChatsAfterDays) &&
            rawSettings.autoArchiveChatsAfterDays > 0
          ? rawSettings.autoArchiveChatsAfterDays
          : DEFAULT_SETTINGS.archiveChatsAfterDays,
    autoCompactContext:
      typeof rawSettings.autoCompactContext === "boolean"
        ? rawSettings.autoCompactContext
        : DEFAULT_SETTINGS.autoCompactContext,
    anthropicSelectedModels: dedupeModels(
      Array.isArray(rawSettings.anthropicSelectedModels)
        ? rawSettings.anthropicSelectedModels.map(normalizeClaudeCodeModelId)
        : [],
    ),
    defaultModel:
      typeof rawSettings.defaultModel === "string"
        ? rawSettings.defaultModel
        : "",
    defaultGitGenerationModel:
      typeof rawSettings.defaultGitGenerationModel === "string"
        ? rawSettings.defaultGitGenerationModel
        : "",
    defaultModelSpeed: normalizeModelSpeed(rawSettings.defaultModelSpeed),
    defaultReasoningEffort: normalizeReasoningEffort(
      rawSettings.defaultReasoningEffort,
    ),
    expandToolCalls:
      typeof rawSettings.expandToolCalls === "boolean"
        ? rawSettings.expandToolCalls
        : typeof rawSettings.expandShellToolParts === "boolean" ||
            typeof rawSettings.expandEditToolParts === "boolean"
          ? rawSettings.expandShellToolParts === true ||
            rawSettings.expandEditToolParts === true
          : DEFAULT_SETTINGS.expandToolCalls,
    groupToolCalls:
      typeof rawSettings.groupToolCalls === "boolean"
        ? rawSettings.groupToolCalls
        : DEFAULT_SETTINGS.groupToolCalls,
    changeCheckpoints:
      typeof rawSettings.changeCheckpoints === "boolean"
        ? rawSettings.changeCheckpoints
        : DEFAULT_SETTINGS.changeCheckpoints,
    cursorSelectedModels: dedupeModels(
      Array.isArray(rawSettings.cursorSelectedModels)
        ? rawSettings.cursorSelectedModels
        : [],
    ),
    grokSelectedModels: dedupeModels(
      Array.isArray(rawSettings.grokSelectedModels)
        ? rawSettings.grokSelectedModels
        : [],
    ),
    openAiSelectedModels: dedupeModels(
      Array.isArray(rawSettings.openAiSelectedModels)
        ? rawSettings.openAiSelectedModels
        : [],
    ),
    openCodeSelectedModels: dedupeModels(
      Array.isArray(rawSettings.openCodeSelectedModels)
        ? rawSettings.openCodeSelectedModels
        : [],
    ),
    locale: normalizeLocalePreference(rawSettings.locale),
    showReasoningSummaries:
      typeof rawSettings.showReasoningSummaries === "boolean"
        ? rawSettings.showReasoningSummaries
        : DEFAULT_SETTINGS.showReasoningSummaries,
    shellPath:
      typeof rawSettings.shellPath === "string" ? rawSettings.shellPath : "",
  };

  const legacyDefaultCandidates = [
    mergedSettings.defaultModel,
    typeof rawSettings.defaultOpenAiModel === "string"
      ? rawSettings.defaultOpenAiModel
      : "",
    typeof rawSettings.defaultAnthropicModel === "string"
      ? normalizeClaudeCodeModelId(rawSettings.defaultAnthropicModel)
      : "",
  ].filter(
    (model): model is string => typeof model === "string" && model.length > 0,
  );

  mergedSettings.defaultModel = getPreferredDefaultModel(
    mergedSettings,
    legacyDefaultCandidates[0] ?? "",
  );
  mergedSettings.defaultGitGenerationModel = getPreferredDefaultModel(
    mergedSettings,
    mergedSettings.defaultGitGenerationModel || mergedSettings.defaultModel,
  );
  const defaultSelection = getDefaultModelSelection(mergedSettings);
  mergedSettings.defaultModelSpeed = defaultSelection.modelSpeed;
  mergedSettings.defaultReasoningEffort = defaultSelection.reasoningEffort;

  const projects = (Array.isArray(state.projects) ? state.projects : []).map(
    (project) => normalizeProject(project, mergedSettings),
  );
  const openProjectIds = new Set(projects.map((project) => project.id));
  const openProjectPathKeys = new Set(
    projects.map((project) => normalizeProjectPathKey(project.path)),
  );
  const closedProjects = (
    Array.isArray(state.closedProjects) ? state.closedProjects : []
  )
    .map((project) => normalizeProject(project, mergedSettings))
    .filter((project) => {
      if (openProjectIds.has(project.id)) {
        return false;
      }

      return !openProjectPathKeys.has(normalizeProjectPathKey(project.path));
    });
  const allProjects = [...projects, ...closedProjects];
  const projectsById = new Map(
    allProjects.map((project) => [project.id, project]),
  );
  const mergedPanelVisibility = {
    ...DEFAULT_PANEL_VISIBILITY,
    ...(legacyState.panelVisibility ?? {}),
    middle: true,
  };
  const mergedPanelSizes = normalizePanelSizes(legacyState.panelSizes);
  const rawProjectPanelSizesByProject =
    legacyState.projectPanelSizesByProject &&
    typeof legacyState.projectPanelSizesByProject === "object"
      ? legacyState.projectPanelSizesByProject
      : {};
  const rawProjectRightPanelOpenByProject =
    legacyState.projectRightPanelOpenByProject &&
    typeof legacyState.projectRightPanelOpenByProject === "object"
      ? legacyState.projectRightPanelOpenByProject
      : {};
  const rawProjectRightPanelViewByProject =
    legacyState.projectRightPanelViewByProject &&
    typeof legacyState.projectRightPanelViewByProject === "object"
      ? legacyState.projectRightPanelViewByProject
      : {};

  const rawChats = Array.isArray(state.chats)
    ? state.chats
    : Array.isArray((state as { threads?: unknown[] }).threads)
      ? ((state as { threads: ChatConfig[] }).threads ?? [])
      : [];
  const normalizedChats = rawChats
    .map((chat) => normalizeChat(chat, projectsById, legacyPermissionMode))
    .filter((chat): chat is ChatConfig => chat !== null);

  const legacyMessagesByChatId =
    state.messagesByChatId && typeof state.messagesByChatId === "object"
      ? state.messagesByChatId
      : state.chats &&
          !Array.isArray(state.chats) &&
          typeof state.chats === "object"
        ? (state.chats as Record<string, UIMessage[]>)
        : {};
  const messagesByChatId: Record<string, UIMessage[]> = {};
  const chats =
    normalizedChats.length > 0
      ? [...normalizedChats]
      : projects.map((project) =>
          createChatConfig(project, { permissionMode: legacyPermissionMode }),
        );
  const projectIdsWithChats = new Set(chats.map((chat) => chat.projectId));
  for (const project of projects) {
    if (!projectIdsWithChats.has(project.id)) {
      const chat = createChatConfig(project, {
        permissionMode: legacyPermissionMode,
      });
      chats.push(chat);
      projectIdsWithChats.add(project.id);
    }
  }

  for (const chat of chats) {
    const chatMessages = legacyMessagesByChatId[chat.id];
    if (isUiMessageArray(chatMessages)) {
      messagesByChatId[chat.id] = chatMessages;
      chat.messageCount = chatMessages.length;
      continue;
    }

    const legacyProjectMessages = legacyMessagesByChatId[chat.projectId];
    if (isUiMessageArray(legacyProjectMessages)) {
      messagesByChatId[chat.id] = legacyProjectMessages;
      chat.messageCount = legacyProjectMessages.length;
      continue;
    }

    // Relational hydration intentionally omits message bodies. Only create an
    // empty loaded entry for chats that are known to have no persisted rows.
    if (chat.messageCount === 0) {
      messagesByChatId[chat.id] = [];
    }
  }

  const applyProjectUi = (project: ProjectConfig): ProjectConfig => {
    const projectChats = chats.filter((chat) => chat.projectId === project.id);
    const legacyActiveChatId =
      legacyState.activeChatIdByProject?.[project.id] ??
      legacyState.activeThreadIdByProject?.[project.id] ??
      null;

    const requestedChatId =
      legacyActiveChatId ?? project.ui.activeChatId ?? null;
    const activeChatId = projectChats.some(
      (chat) => chat.id === requestedChatId,
    )
      ? requestedChatId
      : (projectChats[0]?.id ?? null);
    const legacyRightPanelOpen = rawProjectRightPanelOpenByProject[project.id];
    const legacyRightPanelView = rawProjectRightPanelViewByProject[project.id];

    return {
      ...project,
      ui: sanitizeProjectUiForChats(
        chats,
        project.id,
        {
          ...project.ui,
          panelSizes: normalizePanelSizes(
            rawProjectPanelSizesByProject[project.id],
            project.ui.panelSizes ?? mergedPanelSizes,
          ),
          rightPanelOpen:
            typeof legacyRightPanelOpen === "boolean"
              ? legacyRightPanelOpen
              : (project.ui.rightPanelOpen ?? mergedPanelVisibility.right),
          rightPanelView: isRightPanelView(legacyRightPanelView)
            ? legacyRightPanelView
            : project.ui.rightPanelView,
        },
        activeChatId,
      ),
    };
  };

  const projectsWithUi = projects.map(applyProjectUi);
  const closedProjectsWithUi = closedProjects.map(applyProjectUi);
  const knownProjectIds = new Set(
    [...projectsWithUi, ...closedProjectsWithUi].map((project) => project.id),
  );
  const rawBrowserTabsByProject = normalizeBrowserTabsByProject(
    state.browserTabsByProject,
  );
  const browserTabsByProject = Object.fromEntries(
    Object.entries(rawBrowserTabsByProject).filter(([projectId]) =>
      knownProjectIds.has(projectId),
    ),
  );
  const activeBrowserTabIdByProject = normalizeActiveBrowserTabIds(
    state.activeBrowserTabIdByProject,
    browserTabsByProject,
  );

  return {
    activeProjectId:
      typeof state.activeProjectId === "string" ? state.activeProjectId : null,
    activeBrowserTabIdByProject,
    browserTabsByProject,
    chats,
    closedProjects: closedProjectsWithUi,
    messagesByChatId,
    projects: projectsWithUi,
    settings: mergedSettings,
    chatSort:
      state.chatSort === "createdDesc" ||
      state.chatSort === "createdAsc" ||
      state.chatSort === "titleAsc" ||
      (state as { threadSort?: string }).threadSort === "createdDesc" ||
      (state as { threadSort?: string }).threadSort === "createdAsc" ||
      (state as { threadSort?: string }).threadSort === "titleAsc"
        ? ((state.chatSort ??
            (state as { threadSort?: string })
              .threadSort) as PersistedIdeState["chatSort"])
        : "recent",
  };
};

export const ensureActiveProject = (
  projects: ProjectConfig[],
  activeProjectId: string | null,
) => {
  if (
    activeProjectId &&
    projects.some((project) => project.id === activeProjectId)
  ) {
    return activeProjectId;
  }

  return projects[0]?.id ?? null;
};

export const ensureActiveChatForProject = (
  chats: ChatConfig[],
  projectId: string,
  activeChatId: string | null,
) => {
  const projectChats = chats.filter(
    (chat) => chat.projectId === projectId && chat.deletedAt === null,
  );
  if (activeChatId && projectChats.some((chat) => chat.id === activeChatId)) {
    return activeChatId;
  }

  return projectChats[0]?.id ?? null;
};

export const getChatsForProject = (chats: ChatConfig[], projectId: string) =>
  chats.filter(
    (chat) => chat.projectId === projectId && chat.deletedAt === null,
  );

export const renderUserMessageText = (message: UIMessage): string => {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const sections: string[] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text) {
        sections.push(text);
      }
      continue;
    }

    if (part.type === "file") {
      const label =
        (typeof part.filename === "string" && part.filename.trim()) ||
        (typeof part.mediaType === "string" && part.mediaType.trim()) ||
        "attachment";
      sections.push(`[Attached file: ${label}]`);
    }
  }

  return sections.join("\n\n");
};

export const stringifyPart = (
  value:
    | UIMessage
    | TextUIPart
    | ReasoningUIPart
    | ToolUIPart
    | DynamicToolUIPart
    | FileUIPart
    | SourceUrlUIPart
    | SourceDocumentUIPart
    | unknown,
) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
