import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { UIMessage } from "ai";
import type { AppLocale } from "@/i18n/config";
import type { SparklesPaletteName } from "@/lib/sparkles-palettes";

export type AiProvider =
  | "openai"
  | "anthropic"
  | "opencode"
  | "cursor"
  | "grok";
export type AccentColor =
  | "black-white"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose";
export type BaseColor = "neutral" | "gray" | "zinc" | "stone" | "slate";
export type ModelSpeed = "standard" | "fast";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type AgentMode = "plan" | "build";
export type ChatPermissionMode = "standard" | "full-access";
export type ChatSortOrder =
  | "recent"
  | "createdDesc"
  | "createdAsc"
  | "titleAsc";

export interface ChatBranchPoint {
  chatId: string;
  messageId: string;
}

export interface ChatConfig {
  agentMode: AgentMode;
  branchedFrom: ChatBranchPoint | null;
  id: string;
  messageCount: number;
  permissionMode: ChatPermissionMode;
  projectId: string;
  title: string;
  provider: AiProvider;
  model: string;
  modelSpeed: ModelSpeed;
  reasoningEffort: ReasoningEffort | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  remoteConversationId: string | null;
  remoteConversationModel: string | null;
  remoteConversationModelSpeed: ModelSpeed | null;
  remoteConversationProjectPath: string | null;
  sparklesPalette: SparklesPaletteName;
}

export interface ChatTitleResponse {
  title: string;
}

export interface ProjectReference {
  kind: "file" | "folder";
  name: string;
  parentPath: string;
  path: string;
}

export interface StashItem {
  agentMode: AgentMode;
  createdAt: string;
  id: string;
  model: string;
  modelSpeed: ModelSpeed;
  permissionMode: ChatPermissionMode;
  provider: AiProvider;
  reasoningEffort: ReasoningEffort | null;
  references: ProjectReference[];
  text: string;
  updatedAt: string;
}

export interface PendingChatSubmit {
  preserveDraft?: boolean;
  references: ProjectReference[];
  text: string;
}

export interface ProjectConfig {
  id: string;
  icon: ProjectIconInfo | null;
  lastUsedAt: string | null;
  name: string;
  path: string;
  runCommand: string;
  browserUrl: string;
  provider: AiProvider;
  model: string;
  modelSpeed: ModelSpeed;
  reasoningEffort: ReasoningEffort | null;
  ui: ProjectUiState;
  worktree: ProjectWorktreeInfo | null;
}

export interface ProjectIconInfo {
  path: string;
  mimeType: string;
  source: string;
  mtimeMs: number;
}

export interface ProjectWorktreeInfo {
  kind: "worktree";
  parentProjectId: string | null;
  repoRoot: string;
  mainWorktreePath: string;
  branch: string;
  baseRef: string | null;
  managed: boolean;
  createdAt: string;
}

export interface AppSettings {
  archiveChatsAfterDays: number;
  autoCompactContext: boolean;
  defaultModel: string;
  defaultGitGenerationModel: string;
  defaultModelSpeed: ModelSpeed;
  defaultReasoningEffort: ReasoningEffort | null;
  expandToolCalls: boolean;
  groupToolCalls: boolean;
  openAiSelectedModels: string[];
  anthropicSelectedModels: string[];
  openCodeSelectedModels: string[];
  cursorSelectedModels: string[];
  grokSelectedModels: string[];
  locale: AppLocale;
  showReasoningSummaries: boolean;
  shellPath: string;
}

export interface PanelVisibility {
  left: boolean;
  middle: boolean;
  right: boolean;
}

export interface PanelSizes {
  chatHistoryPanelWidth: number;
  leftSidebarWidth: number;
  rightPanelWidth: number;
  terminalHeight: number;
}

export type RightPanelView =
  | "browser"
  | "explorer"
  | "changes"
  | "terminal"
  | "stash";

export interface ProjectUiState {
  activeChatId: string | null;
  openChatIds: string[];
  chatColumnWidths: Record<string, number>;
  chatHistoryPanelOpen: boolean;
  changesDiffWordWrap: boolean;
  fileEditorWordWrap: boolean;
  multiChat: boolean;
  panelSizes: PanelSizes;
  rightPanelOpen: boolean;
  rightPanelView: RightPanelView;
  stashItems: StashItem[];
}

export interface PersistedIdeState {
  projects: ProjectConfig[];
  closedProjects: ProjectConfig[];
  activeProjectId: string | null;
  activeBrowserTabIdByProject: Record<string, string | null>;
  browserTabsByProject: Record<string, BrowserTabState[]>;
  settings: AppSettings;
  chats: ChatConfig[];
  chatSort: ChatSortOrder;
  messagesByChatId: Record<string, UIMessage[]>;
}

export interface TerminalDataEvent {
  projectId: string;
  chunk: string;
}

export interface TerminalStatusEvent {
  projectId: string;
  status: "running" | "stopped";
  transport?: "pty" | "pipe";
  shell?: string;
  pid?: number;
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

export interface BrowserErrorEvent {
  code: number | string;
  description: string;
}

export interface BrowserStatusEvent {
  loading: boolean;
  projectId: string;
  tabId?: string;
}

export interface BrowserTabState {
  canGoBack: boolean;
  canGoForward: boolean;
  id: string;
  title: string;
  url: string;
  zoomFactor?: number;
}

export interface BrowserPageStateEvent {
  canGoBack: boolean;
  canGoForward: boolean;
  projectId: string;
  tabId: string;
  title: string;
  url: string;
  zoomFactor: number;
}

export type UpdateState =
  | "idle"
  | "disabled"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateStatusEvent {
  currentVersion: string;
  enabled: boolean;
  error: string | null;
  manual: boolean;
  progress: UpdateProgress | null;
  releaseDate: string | null;
  showDetailedStatus: boolean;
  state: UpdateState;
  updatedAt: string;
  updateVersion: string | null;
}

export type ProjectGitChangeStatus =
  | "modified"
  | "added"
  | "renamed"
  | "copied"
  | "deleted"
  | "untracked";

export interface ProjectGitStatusEntry {
  addedLines: number;
  path: string;
  previousPath: string | null;
  removedLines: number;
  staged: boolean;
  status: ProjectGitChangeStatus;
  unstaged: boolean;
}

export interface ProjectGitStatusResponse {
  addedLines: number;
  aheadCount: number;
  baseBranch: string | null;
  branch: string | null;
  changes: ProjectGitStatusEntry[];
  behindCount: number;
  fileCount: number;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  isRepo: boolean;
  remoteName: string | null;
  removedLines: number;
  repoRoot: string | null;
  stagedCount: number;
  unstagedCount: number;
  upstreamBranch: string | null;
}

export interface ProjectGitBranchEntry {
  current: boolean;
  name: string;
}

export interface ProjectGitBranchesResponse {
  branches: ProjectGitBranchEntry[];
  currentBranch: string | null;
  isRepo: boolean;
  repoRoot: string | null;
}

export interface ProjectGitCheckoutResponse extends ProjectGitBranchesResponse {
  created: boolean;
}

export interface ProjectGitWorktreeInfo {
  appManaged: boolean;
  bare: boolean;
  branch: string | null;
  commit: string | null;
  detached: boolean;
  locked: boolean;
  path: string;
  prunable: boolean;
}

export interface ProjectGitWorktreesResponse {
  isRepo: boolean;
  mainWorktreePath: string | null;
  repoRoot: string | null;
  worktrees: ProjectGitWorktreeInfo[];
}

export interface ProjectGitCreateWorktreeRequest {
  baseRef?: string | null;
  branchName: string;
  projectPath: string;
}

export interface ProjectGitCreateWorktreeResponse {
  baseRef: string | null;
  branch: string;
  mainWorktreePath: string;
  path: string;
  repoRoot: string;
}

export interface ProjectGitRemoveWorktreeRequest {
  force?: boolean;
  projectPath: string;
  worktreePath: string;
}

export interface ProjectGitRemoveWorktreeResponse {
  removed: boolean;
  path: string;
}

export interface ProjectGitWorktreeCompareRequest {
  baseRef?: string | null;
  projectPath: string;
}

export interface ProjectGitWorktreeCompareResponse {
  aheadCount: number;
  baseBranch: string;
  baseExistsLocally: boolean;
  behindCount: number;
  branch: string;
  commits: ProjectGitPushPreviewCommit[];
  compareRef: string;
  files: ProjectGitStatusEntry[];
  ghAvailable: boolean;
  mainBranch: string | null;
  mainClean: boolean;
  mainDirtyCount: number;
  mainInProgressOperation: boolean;
  mainWorktreePath: string;
  mergeBase: string | null;
  remoteName: string | null;
  totalCommits: number;
  truncated: boolean;
  upstreamBranch: string | null;
  worktreePath: string;
  worktreeStatus: ProjectGitStatusResponse;
}

export interface ProjectGitWorktreeCompareDiffRequest
  extends ProjectGitWorktreeCompareRequest {
  filePath: string;
  previousPath: string | null;
  status: ProjectGitChangeStatus;
}

export interface ProjectGitWorktreeMergeRequest {
  acknowledgeUncommitted: boolean;
  baseRef?: string | null;
  projectPath: string;
}

export type ProjectGitWorktreeMergeResponse =
  | {
      baseBranch: string;
      branch: string;
      fastForward: boolean;
      mainWorktreePath: string;
      mergeCommit: string;
      previousMainBranch: string | null;
      status: "merged";
    }
  | {
      baseBranch: string;
      branch: string;
      conflictingFiles: string[];
      mainWorktreePath: string;
      previousMainBranch: string | null;
      status: "conflict";
    };

export interface ProjectGitWorktreeCleanupRequest {
  deleteBranch: boolean;
  force: boolean;
  projectPath: string;
  worktreePath: string;
}

export interface ProjectGitWorktreeCleanupResponse {
  branch: string | null;
  branchDeleted: boolean;
  branchDeleteError: string | null;
  path: string;
  pruned: boolean;
  removed: true;
}

export type WorktreeCompletionAction = "merge" | "pr" | "remove";

export interface ProjectGitDiffResponse {
  branch: string | null;
  diff: string;
  filePath: string;
  parsedDiff: FileDiffMetadata | null;
  previousPath: string | null;
  status: ProjectGitChangeStatus;
}

export interface ProjectGitCommitRequest {
  customInstructions?: string | null;
  includeUnstaged: boolean;
  message?: string | null;
  projectPath: string;
}

export interface ProjectGitCommitResponse {
  commitHash: string | null;
  commitMessage: string;
  committed: boolean;
  status: ProjectGitStatusResponse;
}

export interface ProjectGitCommitMessageResponse {
  commitMessage: string;
}

export interface ProjectGitPushPreviewCommit {
  authorDate: string;
  authorName: string;
  hash: string;
  shortHash: string;
  subject: string;
}

export interface ProjectGitPushPreviewResponse {
  aheadCount: number;
  baseRef: string | null;
  behindCount: number;
  branch: string;
  commits: ProjectGitPushPreviewCommit[];
  remoteName: string | null;
  target: string;
  totalCommits: number;
  truncated: boolean;
  upstreamBranch: string | null;
}

export type ProjectGitPushNextStep = "push" | "commit-push";

export interface ProjectGitPushRequest {
  commitMessage?: string | null;
  customInstructions?: string | null;
  includeUnstaged: boolean;
  nextStep: ProjectGitPushNextStep;
  projectPath: string;
}

export interface ProjectGitPushResponse {
  branch: string;
  commit: ProjectGitCommitResponse | null;
  pushed: boolean;
  status: ProjectGitStatusResponse;
  upstreamBranch: string | null;
}

export type ProjectGitCreatePrNextStep =
  | "create"
  | "push-create"
  | "commit-push-create";

export interface ProjectGitCreatePrRequest {
  baseBranch?: string | null;
  commitMessage?: string | null;
  customInstructions?: string | null;
  description?: string | null;
  draft: boolean;
  includeUnstaged: boolean;
  nextStep: ProjectGitCreatePrNextStep;
  openPrPage: boolean;
  projectPath: string;
  title?: string | null;
}

export interface ProjectGitCreatePrResponse {
  baseBranch: string;
  commit: ProjectGitCommitResponse | null;
  draft: boolean;
  headBranch: string;
  push: ProjectGitPushResponse | null;
  status: ProjectGitStatusResponse;
  title: string;
  url: string | null;
}

export interface ProjectGitPullRequestDetailsRequest {
  baseBranch?: string | null;
  customInstructions?: string | null;
  includeUnstaged: boolean;
  model?: string | null;
  nextStep: ProjectGitCreatePrNextStep;
  projectPath: string;
  provider: AiProvider;
}

export interface ProjectGitPullRequestDetailsResponse {
  baseBranch: string;
  commitMessage: string | null;
  description: string;
  headBranch: string;
  title: string;
}

export interface StartTerminalPayload {
  projectId: string;
  cwd: string;
  command?: string;
  shellPath?: string;
  strictCwd?: boolean;
}

export interface TerminalShellOption {
  id: string;
  label: string;
  shellPath: string;
}

export interface TerminalInputPayload {
  projectId: string;
  data: string;
}

export interface TerminalResizePayload {
  projectId: string;
  cols: number;
  rows: number;
}

export interface BrowserUpdatePayload {
  clearCache?: boolean;
  clearCookies?: boolean;
  openDevTools?: boolean;
  projectId?: string;
  tabId?: string;
  takeScreenshot?: boolean;
  webContentsId?: number;
}

export interface DesktopApi {
  isElectron: true;
  apiSessionToken: string;
  initialThemePreferences?: {
    accentColor?: string;
    baseColor?: string;
    theme?: "dark" | "light" | "system";
  };

  openExternal: (url: string) => Promise<boolean>;
  openPath: (path: string) => Promise<boolean>;
  writeClipboardText: (text: string) => Promise<boolean>;
  saveTextFile: (payload: {
    contents: string;
    defaultPath?: string;
    title?: string;
  }) => Promise<boolean>;

  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;

  pickProjectDirectory: () => Promise<string | null>;

  loadState: () => Promise<Partial<PersistedIdeState>>;
  loadChatMessages: (chatId: string) => Promise<UIMessage[]>;
  saveState: (state: PersistedIdeState) => Promise<boolean>;
  saveChatMessages: (payload: {
    chatId: string;
    messages: UIMessage[];
  }) => Promise<boolean>;
  saveActiveProject: (payload: {
    activeProjectId: string | null;
    lastUsedAt: string | null;
  }) => Promise<boolean>;
  getThemePreferences: () => Promise<{
    accentColor?: string;
    baseColor?: string;
    theme?: "dark" | "light" | "system";
  }>;
  setThemePreference: (theme: "dark" | "light" | "system") => Promise<boolean>;
  setBaseColor: (baseColor: string) => Promise<boolean>;
  setAccentColor: (accentColor: string) => Promise<boolean>;

  detectTerminalShells: () => Promise<TerminalShellOption[]>;
  startTerminal: (payload: StartTerminalPayload) => Promise<{
    status: string;
    pid?: number;
    transport?: "pty" | "pipe";
    shell?: string;
  }>;
  sendTerminalInput: (payload: TerminalInputPayload) => void;
  resizeTerminal: (payload: TerminalResizePayload) => void;
  stopTerminal: (projectId: string) => Promise<boolean>;
  stopAllTerminals: () => Promise<boolean>;
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void;
  onTerminalStatus: (
    listener: (event: TerminalStatusEvent) => void,
  ) => () => void;

  updateBrowser: (payload: BrowserUpdatePayload) => void;
  onBrowserError: (listener: (event: BrowserErrorEvent) => void) => () => void;
  onBrowserPageState: (
    listener: (event: BrowserPageStateEvent) => void,
  ) => () => void;
  onBrowserStatus: (
    listener: (event: BrowserStatusEvent) => void,
  ) => () => void;

  detectEditors: () => Promise<DetectedEditor[]>;
  openInEditor: (payload: {
    projectPath: string;
    editorId: string;
  }) => Promise<boolean>;

  getUpdateStatus: () => Promise<UpdateStatusEvent>;
  checkForUpdates: () => Promise<UpdateStatusEvent>;
  installUpdate: () => Promise<boolean>;
  onUpdateStatus: (listener: (event: UpdateStatusEvent) => void) => () => void;
}

export interface DetectedEditor {
  id: string;
  name: string;
  executable: string;
  isFileExplorer: boolean;
  isTerminal: boolean;
}
