import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dreamSvg from "@/assets/dream.svg";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useProjectGitStatus } from "@/hooks/use-project-git-status";
import {
  getConnectedProviders,
  getDefaultGitGenerationModelSelection,
  getModelOptionsForProvider,
} from "@/lib/ide-defaults";
import {
  getModelContextWindow,
  getModelReasoningEfforts,
  getModelSpeedTiers,
} from "@/lib/models";
import type {
  ChatConfig,
  ChatTitleResponse,
  ProjectConfig,
  ProjectReference,
} from "@/types/ide";
import { getActivityAttention } from "./activity-status";
import { useActivityStore } from "./activity-store";
import {
  getChipToolKind,
  getToolName,
  isToolLikePart,
  normalizeToolName,
  type ToolLikePart,
} from "./assistant-message-tools";
import {
  CHAT_CONTENT_BOTTOM_PADDING_PX,
  CHAT_STREAM_UPDATE_THROTTLE_MS,
  ChatMessage,
  type ChatMessageMetadata,
  type EditTarget,
  PROVIDER_LABELS,
  type ToolApprovalResponder,
} from "./chat";
import { ChatComposer, type ChatPanelModelOption } from "./chat/chat-composer";
import { ChatErrorBanner } from "./chat/chat-error-banner";
import { ChatPanelHeader } from "./chat/chat-panel-header";
import {
  useChatAutoScroll,
  useChatMessageSync,
  usePromptHistoryNavigation,
} from "./chat/chat-panel-hooks";
import type { ContinueChatPopoverContext } from "./chat/continue-chat-popover";
import { EditChatDialog } from "./chat/edit-chat-dialog";
import { estimateMessages } from "./chat/message-token-estimate";
import { projectMessagesForRequest } from "./chat/request-context";
import { getLatestChatTodoSummary } from "./chat/todo-list";
import {
  CHAT_TRANSCRIPT_WINDOW_SIZE,
  getTranscriptWindow,
} from "./chat/transcript-window";
import { mergeChatMessageHistories } from "./chat-message-history";
import { warmProjectCommitMessage } from "./git-commit-message-cache";
import { chatIsAwaitingAnswer } from "./header/project-tab-status";
import { useIdeStore } from "./ide-store";
import {
  MODEL_SPEED_OPTIONS,
  normalizeModelSpeed,
  normalizeReasoningEffort,
  REASONING_EFFORT_OPTIONS,
} from "./ide-types";
import {
  flushProjectPanelRefresh,
  scheduleProjectPanelRefresh,
} from "./project-panel-refresh";
import { ProjectBranchFooter } from "./project-status-bar";
import { WORKSPACE_VIEWPORT_BACKGROUND } from "./workspace";

const EMPTY_MESSAGES: UIMessage[] = [];
const CHAT_PANEL_BACKGROUND_STYLE: CSSProperties = {
  backgroundColor: WORKSPACE_VIEWPORT_BACKGROUND,
};
const CHAT_HISTORY_MESSAGE_STYLE: CSSProperties = {
  containIntrinsicSize: "auto 180px",
  contentVisibility: "auto",
};
const CHAT_CONVERSATION_FADE_HEIGHT_PX = 24;
const CHAT_CONVERSATION_FADE_HORIZONTAL_INSET =
  "max(0px, calc((100% - 700px) / 2))";
const CHAT_CONVERSATION_FADE_RIGHT_INSET =
  "max(12px, calc((100% - 700px) / 2))";
const CLAUDE_SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const CHAT_CONVERSATION_TOP_FADE_STYLE: CSSProperties = {
  background: `linear-gradient(to bottom, ${WORKSPACE_VIEWPORT_BACKGROUND} 0%, transparent 100%)`,
  height: CHAT_CONVERSATION_FADE_HEIGHT_PX,
  left: CHAT_CONVERSATION_FADE_HORIZONTAL_INSET,
  right: CHAT_CONVERSATION_FADE_RIGHT_INSET,
};
const CHAT_CONVERSATION_BOTTOM_FADE_STYLE: CSSProperties = {
  background: `linear-gradient(to top, ${WORKSPACE_VIEWPORT_BACKGROUND} 0%, transparent 100%)`,
  height: CHAT_CONVERSATION_FADE_HEIGHT_PX,
  left: CHAT_CONVERSATION_FADE_HORIZONTAL_INSET,
  right: CHAT_CONVERSATION_FADE_RIGHT_INSET,
};

const getUsageContextTokens = (usage: LanguageModelUsage) => {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return undefined;
  }

  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0)
  );
};

// A turn's exact input usage already includes the previous chat history.
// Summing exact usage across turns double-counts older messages, so the latest
// assistant usage is the best exact snapshot of current context pressure.
const getLatestAssistantMetadata = (messages: UIMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const metadata = message.metadata as ChatMessageMetadata | undefined;
    if (metadata) {
      return metadata;
    }
  }

  return undefined;
};

const formatProjectReferencesForPrompt = (references: ProjectReference[]) =>
  references
    .map((reference) => `- ${reference.kind}: ${reference.path}`)
    .join("\n");

const getAskUserQuestionApprovalPayload = (reason?: string) => {
  if (!reason) {
    return null;
  }

  try {
    const parsed = JSON.parse(reason);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("answers" in parsed) ||
      !parsed.answers ||
      typeof parsed.answers !== "object"
    ) {
      return null;
    }

    return parsed as { answers: Record<string, unknown> };
  } catch {
    return null;
  }
};

const getAskUserQuestionApprovalId = (part: UIMessage["parts"][number]) => {
  if (!isToolLikePart(part)) {
    return null;
  }

  return (
    part.approval?.id ??
    (typeof part.toolCallId === "string"
      ? `anthropic:${part.toolCallId}`
      : null)
  );
};

const isAskUserQuestionPart = (
  part: UIMessage["parts"][number],
): part is ToolLikePart =>
  isToolLikePart(part) &&
  normalizeToolName(getToolName(part)) === "ask-user-question";

const getAskUserQuestionPayloadFromPart = (
  part: UIMessage["parts"][number],
) => {
  if (!isAskUserQuestionPart(part)) {
    return null;
  }

  const outputPayload =
    part.output &&
    typeof part.output === "object" &&
    !Array.isArray(part.output)
      ? (part.output as { answers?: unknown })
      : null;

  if (
    outputPayload?.answers &&
    typeof outputPayload.answers === "object" &&
    !Array.isArray(outputPayload.answers)
  ) {
    return { answers: outputPayload.answers as Record<string, unknown> };
  }

  return getAskUserQuestionApprovalPayload(part.approval?.reason);
};

const preserveAskUserQuestionAnswers = (
  messages: UIMessage[],
  sourceMessages: UIMessage[],
) => {
  const answersByApprovalId = new Map<
    string,
    { answers: Record<string, unknown>; reason?: string }
  >();

  for (const message of sourceMessages) {
    for (const part of message.parts) {
      const approvalId = getAskUserQuestionApprovalId(part);
      const payload = getAskUserQuestionPayloadFromPart(part);
      if (approvalId && payload) {
        answersByApprovalId.set(approvalId, {
          ...payload,
          reason: isToolLikePart(part) ? part.approval?.reason : undefined,
        });
      }
    }
  }

  if (answersByApprovalId.size === 0) {
    return messages;
  }

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let partsChanged = false;
    const nextParts = message.parts.map((part) => {
      if (!isAskUserQuestionPart(part)) {
        return part;
      }

      const approvalId = getAskUserQuestionApprovalId(part);
      const payload = approvalId ? answersByApprovalId.get(approvalId) : null;
      if (!approvalId || !payload) {
        return part;
      }

      const updatedInput =
        part.input &&
        typeof part.input === "object" &&
        !Array.isArray(part.input)
          ? { ...part.input, answers: payload.answers }
          : part.input;

      changed = true;
      partsChanged = true;
      return {
        ...part,
        approval: {
          ...(part.approval ?? { id: approvalId }),
          approved: true,
          ...(payload.reason ? { reason: payload.reason } : {}),
        },
        input: updatedInput,
        output: { answers: payload.answers },
        state: "output-available",
      } as UIMessage["parts"][number];
    });

    return partsChanged ? { ...message, parts: nextParts } : message;
  });

  return changed ? nextMessages : messages;
};

const addAskUserQuestionAnswerToMessages = (
  messages: UIMessage[],
  response: Parameters<ToolApprovalResponder>[0],
) => {
  if (!response.approved) {
    return messages;
  }

  const approvalPayload = getAskUserQuestionApprovalPayload(response.reason);
  if (!approvalPayload) {
    return messages;
  }

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let partsChanged = false;
    const nextParts = message.parts.map((part) => {
      if (
        !isToolLikePart(part) ||
        normalizeToolName(getToolName(part)) !== "ask-user-question"
      ) {
        return part;
      }

      const approvalId = getAskUserQuestionApprovalId(part);
      if (approvalId !== response.id) {
        return part;
      }

      changed = true;
      partsChanged = true;
      const updatedInput =
        part.input &&
        typeof part.input === "object" &&
        !Array.isArray(part.input)
          ? { ...part.input, ...approvalPayload }
          : part.input;

      return {
        ...part,
        approval: {
          ...(part.approval ?? { id: response.id }),
          approved: true,
          reason: response.reason,
        },
        input: updatedInput,
        output: approvalPayload,
        state: "output-available",
      } as UIMessage["parts"][number];
    });

    return !partsChanged
      ? message
      : {
          ...message,
          parts: nextParts,
        };
  });

  return changed ? nextMessages : messages;
};

export const ChatPanel = ({
  canCloseChat = false,
  isActive,
  isProjectActive = isActive,
  onActivateChat,
  onCloseChat,
  onHeaderPointerDown,
  project,
  chat,
}: {
  canCloseChat?: boolean;
  isActive: boolean;
  isProjectActive?: boolean;
  onActivateChat?: () => void;
  onCloseChat?: () => void;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  project: ProjectConfig;
  chat: ChatConfig;
}) => {
  const chatT = useTranslations("chat");
  const commonT = useTranslations("common");
  const modelT = useTranslations("models");
  const workspaceT = useTranslations("workspace");
  const panelDomId = `chat-panel-${chat.id}`;
  const conversationDomId = `chat-conversation-${chat.id}`;
  const conversationContentDomId = `chat-conversation-content-${chat.id}`;
  const promptDomId = `chat-prompt-${chat.id}`;
  const promptInputDomId = `chat-prompt-input-${chat.id}`;
  const settings = useIdeStore((s) => s.settings);
  const chatMessages = useIdeStore(
    (s) => s.messagesByChatId[chat.id] ?? EMPTY_MESSAGES,
  );
  const messagesLoaded = useIdeStore((s) =>
    Object.hasOwn(s.messagesByChatId, chat.id),
  );
  const loadMessagesForChat = useIdeStore((s) => s.loadMessagesForChat);
  const isDraftChat = useIdeStore(
    (s) => s.draftChatIdByProject[project.id] === chat.id,
  );
  const isTitleGenerating = useIdeStore(
    (s) => !!s.titleGeneratingChatIds[chat.id],
  );
  const providerModels = useIdeStore((s) => s.providerModels);
  const persistMessagesForChat = useIdeStore((s) => s.persistMessagesForChat);
  const setChatTitleGenerating = useIdeStore((s) => s.setChatTitleGenerating);
  const setChatAwaitingAnswer = useIdeStore((s) => s.setChatAwaitingAnswer);
  const updateChat = useIdeStore((s) => s.updateChat);
  const deleteChat = useIdeStore((s) => s.deleteChat);
  const addProjectTerminal = useIdeStore((s) => s.addProjectTerminal);
  const pendingChatSubmit = useIdeStore(
    (s) => s.pendingChatSubmitByChatId[chat.id] ?? null,
  );
  const takePendingChatSubmit = useIdeStore((s) => s.takePendingChatSubmit);
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[project.id] ?? 0,
  );
  const { branch: currentGitBranch, isRepo } = useProjectGitStatus(
    project.path,
    gitRefreshKey,
    {
      detail: "summary",
    },
  );
  const autoApproveClaudeWrites =
    chat.permissionMode === "full-access" || chat.agentMode === "build";
  const connectedProviders = getConnectedProviders(settings);
  const gitGenerationModelSelection = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const allModelOptions = useMemo<ChatPanelModelOption[]>(() => {
    return connectedProviders.flatMap((provider) =>
      getModelOptionsForProvider(
        provider,
        settings,
        providerModels[provider].models,
      ).map((model) => ({
        contextWindow: model.contextWindow,
        id: model.id,
        label: model.label,
        provider,
        reasoningEfforts: model.reasoningEfforts ?? [],
        speedTiers: model.speedTiers ?? [],
      })),
    );
  }, [connectedProviders, providerModels, settings]);

  const selectedModelOption =
    allModelOptions.find(
      (option) => option.provider === chat.provider && option.id === chat.model,
    ) ?? allModelOptions[0];
  const selectedProvider = selectedModelOption?.provider ?? chat.provider;
  const isProviderInstalled =
    providerModels[selectedProvider]?.installed ?? false;
  const [localError, setLocalError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState("");
  const [transcriptWindowSize, setTranscriptWindowSize] = useState(
    CHAT_TRANSCRIPT_WINDOW_SIZE,
  );
  const prependScrollSnapshotRef = useRef<{
    element: HTMLElement;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const previousMessageCountRef = useRef(0);
  const restoredTranscriptWindowSizeRef = useRef(CHAT_TRANSCRIPT_WINDOW_SIZE);
  const refreshedWriteEventsRef = useRef(new Set<string>());
  const pendingAssistantMetadataRef = useRef<ChatMessageMetadata | null>(null);

  useEffect(() => {
    if (!messagesLoaded) {
      void loadMessagesForChat(chat.id).catch(() => {
        setLocalError(chatT("unexpectedError"));
      });
    }
  }, [chat.id, chatT, loadMessagesForChat, messagesLoaded]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          body,
          id,
          messageId,
          messages: requestMessages,
          trigger,
        }) => ({
          body: {
            ...body,
            id,
            messageId,
            messages: projectMessagesForRequest(requestMessages),
            trigger,
          },
        }),
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    addToolApprovalResponse: addAiSdkToolApprovalResponse,
    clearError,
  } = useChat({
    experimental_throttle: CHAT_STREAM_UPDATE_THROTTLE_MS,
    id: `chat:${chat.id}`,
    messages: chatMessages,
    onError: (error) => {
      useActivityStore.getState().finish(chat.id, "failed", error.message);
      console.error("[chat error]", error);

      // The server-side onError already enriches the message, so
      // error.message should be descriptive. Guard against edge cases
      // where only the generic class name "Error" comes through.
      const msg = error.message;
      if (msg && msg !== "Error") {
        setLocalError(msg);
        return;
      }

      // Fallback: try cause chain
      if (error.cause instanceof Error && error.cause.message) {
        setLocalError(error.cause.message);
        return;
      }

      setLocalError(chatT("unexpectedError"));
    },
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      const attention = getActivityAttention([message]);
      if (!isAbort && !isError && !isDisconnect && attention !== null) {
        useActivityStore.getState().attention(chat.id, attention);
      } else {
        useActivityStore
          .getState()
          .finish(
            chat.id,
            isError
              ? "failed"
              : isAbort || isDisconnect
                ? "interrupted"
                : "finished",
          );
      }
      const metadata = message.metadata as ChatMessageMetadata | undefined;
      const pendingMetadata = pendingAssistantMetadataRef.current;
      pendingAssistantMetadataRef.current = null;
      const completedAt = new Date().toISOString();
      const messageMetadata =
        (message.metadata as Record<string, unknown> | undefined) ?? {};
      const finalAssistantMessage: UIMessage = {
        ...message,
        metadata: {
          ...messageMetadata,
          ...(pendingMetadata ?? {}),
          ...(metadata?.usage ? { usage: metadata.usage } : {}),
          completedAt:
            typeof metadata?.completedAt === "string" && metadata.completedAt
              ? metadata.completedAt
              : completedAt,
          createdAt:
            typeof metadata?.createdAt === "string" && metadata.createdAt
              ? metadata.createdAt
              : pendingMetadata?.createdAt || completedAt,
          startedAt:
            typeof metadata?.startedAt === "string" && metadata.startedAt
              ? metadata.startedAt
              : pendingMetadata?.startedAt ||
                pendingMetadata?.createdAt ||
                (typeof metadata?.createdAt === "string" && metadata.createdAt
                  ? metadata.createdAt
                  : completedAt),
        },
      };

      const finalMessagesWithQuestionAnswers = preserveAskUserQuestionAnswers(
        [finalAssistantMessage],
        latestMessagesRef.current,
      );
      const nextMessages = mergeChatMessageHistories(
        latestMessagesRef.current,
        finalMessagesWithQuestionAnswers,
      );
      latestMessagesRef.current = nextMessages;
      setMessages(nextMessages);
      void persistMessagesForChat(chat.id, nextMessages);

      const remoteConversationId = metadata?.remoteConversationId?.trim();

      if (!remoteConversationId) {
        return;
      }

      updateChat(chat.id, (current) => ({
        ...current,
        remoteConversationId,
        remoteConversationModel:
          metadata?.remoteConversationModel ?? current.model,
        remoteConversationModelSpeed: normalizeModelSpeed(
          metadata?.remoteConversationModelSpeed ?? current.modelSpeed,
        ),
        remoteConversationProjectPath:
          metadata?.remoteConversationProjectPath ?? project.path,
      }));
    },
    transport,
  });
  const latestMessagesRef = useRef<UIMessage[]>(messages);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const awaiting = chatIsAwaitingAnswer(messages);
    setChatAwaitingAnswer(chat.id, awaiting);
    useActivityStore
      .getState()
      .attention(chat.id, getActivityAttention(messages));
  }, [chat.id, messages, setChatAwaitingAnswer]);

  useEffect(
    () => () => setChatAwaitingAnswer(chat.id, false),
    [chat.id, setChatAwaitingAnswer],
  );

  const addToolApprovalResponse = useCallback<ToolApprovalResponder>(
    (response) => {
      const messagesWithApprovalAnswer = addAskUserQuestionAnswerToMessages(
        latestMessagesRef.current,
        response,
      );
      if (messagesWithApprovalAnswer !== latestMessagesRef.current) {
        latestMessagesRef.current = messagesWithApprovalAnswer;
        setMessages(messagesWithApprovalAnswer);
        void persistMessagesForChat(chat.id, messagesWithApprovalAnswer);
      }

      if (!response.id.startsWith("anthropic:")) {
        void Promise.resolve(
          addAiSdkToolApprovalResponse({
            approved: response.approved,
            id: response.id,
            reason: response.reason,
          }),
        ).catch((error: unknown) => {
          console.debug("[tool approval ai-sdk response]", error);
        });
      }

      void fetch("/api/tool-approval-response", {
        body: JSON.stringify({
          approved: response.approved,
          id: response.id,
          reason: response.reason ?? null,
          scope: response.scope ?? "once",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch((error) => {
        console.error("[tool approval response]", error);
      });
    },
    [
      addAiSdkToolApprovalResponse,
      chat.id,
      persistMessagesForChat,
      setMessages,
    ],
  );

  useChatMessageSync({
    chatId: chat.id,
    chatMessages,
    isActive,
    messages,
    persistMessagesForChat,
    setMessages,
  });

  // Only the live tail can gain new write results. Avoid walking the entire
  // transcript on every stream update, then coalesce bursts across every chat
  // in the project before refreshing Git and the file tree.
  const latestStreamMessage = messages.at(-1);
  useEffect(() => {
    if (latestStreamMessage?.role !== "assistant") {
      return;
    }

    let shouldRefreshProjectPanels = false;
    for (
      let partIndex = 0;
      partIndex < latestStreamMessage.parts.length;
      partIndex++
    ) {
      const part = latestStreamMessage.parts[partIndex];
      if (getChipToolKind(part) !== "write") {
        continue;
      }

      const partRecord = part as Record<string, unknown>;
      if (partRecord.state !== "output-available") {
        continue;
      }

      const writeRefreshKey = `${chat.id}:${latestStreamMessage.id}:${partIndex}`;
      if (!refreshedWriteEventsRef.current.has(writeRefreshKey)) {
        refreshedWriteEventsRef.current.add(writeRefreshKey);
        shouldRefreshProjectPanels = true;
      }
    }

    if (shouldRefreshProjectPanels) {
      scheduleProjectPanelRefresh(project.id);
    }
  }, [chat.id, latestStreamMessage, project.id]);

  // Auto-approve Anthropic writeFile tool calls for non-interactive modes.
  useEffect(() => {
    if (!autoApproveClaudeWrites) {
      return;
    }
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (
          typeof part.type === "string" &&
          part.type === "tool-writeFile" &&
          "approval" in part &&
          part.approval &&
          typeof part.approval === "object" &&
          "id" in part.approval &&
          !("approved" in part.approval) &&
          "state" in part &&
          part.state === "approval-requested"
        ) {
          addToolApprovalResponse({
            id: part.approval.id as string,
            approved: true,
          });
        }
      }
    }
  }, [messages, autoApproveClaudeWrites, addToolApprovalResponse]);

  const selectedModel = selectedModelOption?.id ?? "";
  const selectedModelLabel = selectedModelOption?.label ?? selectedModel;
  const selectedModelValue = selectedModelOption?.id;
  const availableModelSpeedTiers = selectedModelOption?.speedTiers?.length
    ? selectedModelOption.speedTiers
    : getModelSpeedTiers(selectedProvider, selectedModel);
  const speedOptions = MODEL_SPEED_OPTIONS.filter((option) =>
    availableModelSpeedTiers.includes(option.value),
  );
  const normalizedChatModelSpeed = normalizeModelSpeed(chat.modelSpeed);
  const selectedModelSpeed =
    availableModelSpeedTiers.length === 0
      ? "standard"
      : availableModelSpeedTiers.includes(normalizedChatModelSpeed)
        ? normalizedChatModelSpeed
        : "standard";
  const selectedModelSpeedLabel = modelT(selectedModelSpeed);
  const selectedModelSpeedLabelForMetadata =
    availableModelSpeedTiers.length > 0 ? selectedModelSpeedLabel : undefined;
  const availableReasoningEfforts = selectedModelOption?.reasoningEfforts
    ?.length
    ? selectedModelOption.reasoningEfforts
    : getModelReasoningEfforts(selectedProvider, selectedModel);
  const reasoningEffortOptions = REASONING_EFFORT_OPTIONS.filter((option) =>
    availableReasoningEfforts.includes(option.value),
  );
  const normalizedChatReasoningEffort = normalizeReasoningEffort(
    chat.reasoningEffort,
  );
  const selectedReasoningEffort =
    availableReasoningEfforts.length === 0
      ? null
      : normalizedChatReasoningEffort &&
          availableReasoningEfforts.includes(normalizedChatReasoningEffort)
        ? normalizedChatReasoningEffort
        : availableReasoningEfforts.includes("medium")
          ? "medium"
          : availableReasoningEfforts[0];
  const selectedReasoningEffortForControl = selectedReasoningEffort ?? "medium";
  const selectedReasoningLabel =
    selectedReasoningEffort === null
      ? modelT("reasoning")
      : modelT(selectedReasoningEffort);
  const selectedReasoningLabelForMetadata =
    selectedReasoningEffort !== null ? selectedReasoningLabel : undefined;

  const latestAssistantMetadata = useMemo(
    () => getLatestAssistantMetadata(messages),
    [messages],
  );
  const latestAssistantContextMetadata =
    latestAssistantMetadata?.model === selectedModel
      ? latestAssistantMetadata
      : undefined;
  const contextWindow =
    latestAssistantContextMetadata?.contextWindow ??
    selectedModelOption?.contextWindow ??
    getModelContextWindow(selectedModel);
  const contextUsage = latestAssistantContextMetadata?.usage;
  const fallbackEstimatedTokens = useMemo(
    () => (contextUsage ? 0 : estimateMessages(messages)),
    [contextUsage, messages],
  );
  const contextUsedTokens =
    (contextUsage ? getUsageContextTokens(contextUsage) : undefined) ??
    fallbackEstimatedTokens;
  const todoSummary = useMemo(
    () => getLatestChatTodoSummary(messages),
    [messages],
  );

  const modelId =
    selectedProvider === "anthropic"
      ? `anthropic:${selectedModel}`
      : selectedProvider === "opencode"
        ? `opencode:${selectedModel}`
        : selectedProvider === "cursor"
          ? `cursor:${selectedModel}`
          : `openai:${selectedModel}`;

  const isStreaming = status === "streaming";
  const isProcessing = status === "submitted" || status === "streaming";
  const claudeSessionId = chat.remoteConversationId?.trim() ?? "";
  const claudeSessionProjectPath =
    chat.remoteConversationProjectPath?.trim() ?? "";
  const canContinueInTerminal =
    chat.provider === "anthropic" &&
    CLAUDE_SESSION_ID_PATTERN.test(claudeSessionId) &&
    Boolean(claudeSessionProjectPath);
  const handleContinueInTerminal = useCallback(() => {
    if (!canContinueInTerminal || isProcessing) {
      return;
    }

    setLocalError(null);
    void addProjectTerminal(project.id, {
      command: `claude --resume ${claudeSessionId}`,
      cwd: claudeSessionProjectPath,
      name: "Claude",
      strictCwd: true,
    }).catch((error) => {
      console.error("Failed to continue Claude session in terminal:", error);
      setLocalError(chatT("unableToContinueInTerminal"));
    });
  }, [
    addProjectTerminal,
    canContinueInTerminal,
    chatT,
    claudeSessionId,
    claudeSessionProjectPath,
    isProcessing,
    project.id,
  ]);
  const handleBranchError = useCallback((message: string) => {
    setLocalError(message);
  }, []);
  const continueChat = useMemo<ContinueChatPopoverContext>(
    () => ({
      chat,
      currentBranch: currentGitBranch,
      isProcessing,
      isRepo,
      onError: handleBranchError,
    }),
    [chat, currentGitBranch, handleBranchError, isProcessing, isRepo],
  );

  const { conversationContextRef, scrollConversationToBottom } =
    useChatAutoScroll({
      isActive,
      isProcessing,
      messages,
    });
  const transcriptWindow = useMemo(
    () => getTranscriptWindow(messages, transcriptWindowSize),
    [messages, transcriptWindowSize],
  );

  useEffect(() => {
    if (messages.length < previousMessageCountRef.current) {
      setTranscriptWindowSize(CHAT_TRANSCRIPT_WINDOW_SIZE);
    }
    previousMessageCountRef.current = messages.length;
  }, [messages.length]);
  const handleLoadEarlierMessages = useCallback(() => {
    const element = conversationContextRef.current?.scrollRef.current;
    prependScrollSnapshotRef.current = element
      ? {
          element,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
        }
      : null;
    setTranscriptWindowSize((currentSize) =>
      Math.min(messages.length, currentSize + CHAT_TRANSCRIPT_WINDOW_SIZE),
    );
  }, [conversationContextRef, messages.length]);

  useLayoutEffect(() => {
    if (restoredTranscriptWindowSizeRef.current === transcriptWindowSize) {
      return;
    }
    restoredTranscriptWindowSizeRef.current = transcriptWindowSize;

    const snapshot = prependScrollSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    prependScrollSnapshotRef.current = null;
    snapshot.element.scrollTop =
      snapshot.scrollTop +
      Math.max(0, snapshot.element.scrollHeight - snapshot.scrollHeight);
  }, [transcriptWindowSize]);
  const { handlePromptKeyDown, resetPromptHistory } =
    usePromptHistoryNavigation({
      messages,
      promptText,
      setPromptText,
    });
  const handleActivateChat = useCallback(() => {
    if (!isActive) {
      onActivateChat?.();
    }
  }, [isActive, onActivateChat]);

  const handleSubmit = useCallback(
    async (prompt: PromptInputMessage, preserveDraft = false) => {
      if (isProcessing) {
        throw new Error(chatT("alreadyStreaming"));
      }

      handleActivateChat();
      setLocalError(null);
      clearError();

      const state = useIdeStore.getState();
      const submittedProject = state.projects.find(
        (item) => item.id === project.id,
      );

      if (!submittedProject || state.activeProjectId !== submittedProject.id) {
        const message = chatT("notInActiveProject");
        setLocalError(message);
        throw new Error(message);
      }

      const submittedProjectPath = submittedProject.path;

      const activeOption =
        allModelOptions.find(
          (option) =>
            option.provider === chat.provider && option.id === chat.model,
        ) ?? allModelOptions[0];
      const activeProvider = activeOption?.provider ?? selectedProvider;
      const activeModel = activeOption?.id ?? "";
      const activeProviderInstalled =
        providerModels[activeProvider]?.installed ?? false;

      if (!activeProviderInstalled) {
        setLocalError(
          chatT("providerCliUnavailable", {
            provider: PROVIDER_LABELS[activeProvider],
          }),
        );
        return;
      }

      if (!activeModel) {
        setLocalError(chatT("enableModelFirst"));
        return;
      }

      const projectReferences = prompt.references ?? [];
      if (
        !prompt.text.trim() &&
        prompt.files.length === 0 &&
        projectReferences.length === 0
      ) {
        return;
      }

      const submittedChatId = chat.id;
      const shouldGenerateTitle =
        chatMessages.length === 0 && chat.title === "New chat";
      const titleBeforeGeneration = chat.title;
      const projectReferencesPrompt =
        projectReferences.length > 0
          ? formatProjectReferencesForPrompt(projectReferences)
          : "";
      const remoteConversationIdForRequest = chat.remoteConversationId;
      const remoteConversationModelForRequest = chat.remoteConversationModel;
      const remoteConversationModelSpeedForRequest =
        chat.remoteConversationModelSpeed;
      const remoteConversationProjectPathForRequest =
        chat.remoteConversationProjectPath;

      const submittedAt = new Date().toISOString();
      pendingAssistantMetadataRef.current = {
        createdAt: submittedAt,
        model: activeModel,
        modelLabel: activeOption?.label ?? activeModel,
        modelSpeed: selectedModelSpeed,
        ...(selectedModelSpeedLabelForMetadata
          ? { modelSpeedLabel: selectedModelSpeedLabelForMetadata }
          : {}),
        ...(selectedReasoningEffort
          ? { reasoningEffort: selectedReasoningEffort }
          : {}),
        ...(selectedReasoningLabelForMetadata
          ? { reasoningLabel: selectedReasoningLabelForMetadata }
          : {}),
        startedAt: submittedAt,
      };
      resetPromptHistory();

      if (!preserveDraft) setPromptText("");
      useIdeStore.getState().setChatStreaming(submittedChatId, true);
      if (shouldGenerateTitle) {
        setChatTitleGenerating(submittedChatId, true);
        void fetch("/api/chat-title", {
          body: JSON.stringify({
            fallbackModel: activeModel,
            projectPath: submittedProjectPath,
            promptText:
              prompt.text ||
              `Referenced project paths:\n${projectReferencesPrompt}`,
            provider: activeProvider,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
          .then(async (response) => {
            if (!response.ok) {
              return "";
            }
            const payload = (await response.json()) as ChatTitleResponse;
            return payload.title.trim();
          })
          .then((generatedTitle) => {
            if (!generatedTitle) {
              return;
            }
            updateChat(submittedChatId, (current) =>
              current.title === titleBeforeGeneration
                ? { ...current, title: generatedTitle }
                : current,
            );
          })
          .catch(() => {
            // Keep the default title when background title generation fails.
          })
          .finally(() => {
            useIdeStore
              .getState()
              .setChatTitleGenerating(submittedChatId, false);
          });
      }
      const finishStreaming = () => {
        useIdeStore.getState().setChatStreaming(submittedChatId, false);
        flushProjectPanelRefresh(submittedProject.id);
        void warmProjectCommitMessage({
          model: gitGenerationModelSelection.model,
          projectPath: submittedProjectPath,
          provider: gitGenerationModelSelection.provider,
          refreshToken:
            useIdeStore.getState().projectGitRefreshKeys[submittedProject.id] ??
            0,
        });
      };

      try {
        const sendPromise = sendMessage(
          {
            files: prompt.files,
            metadata: {
              createdAt: new Date().toISOString(),
              model: activeModel,
              modelLabel: activeOption?.label ?? activeModel,
              modelSpeed: selectedModelSpeed,
              ...(selectedModelSpeedLabelForMetadata
                ? { modelSpeedLabel: selectedModelSpeedLabelForMetadata }
                : {}),
              projectReferences,
              ...(selectedReasoningEffort
                ? { reasoningEffort: selectedReasoningEffort }
                : {}),
              ...(selectedReasoningLabelForMetadata
                ? { reasoningLabel: selectedReasoningLabelForMetadata }
                : {}),
            },
            text: prompt.text,
          },
          {
            body: {
              model: activeModel,
              modelLabel: activeOption?.label ?? activeModel,
              projectReferences,
              projectId: submittedProject.id,
              projectPath: submittedProjectPath,
              permissionMode: chat.permissionMode,
              provider: activeProvider,
              agentMode: chat.agentMode,
              modelSpeed: selectedModelSpeed,
              ...(selectedModelSpeedLabelForMetadata
                ? { modelSpeedLabel: selectedModelSpeedLabelForMetadata }
                : {}),
              ...(selectedReasoningEffort
                ? { reasoningEffort: selectedReasoningEffort }
                : {}),
              ...(selectedReasoningLabelForMetadata
                ? { reasoningLabel: selectedReasoningLabelForMetadata }
                : {}),
              remoteConversationId: remoteConversationIdForRequest,
              remoteConversationModel: remoteConversationModelForRequest,
              remoteConversationModelSpeed:
                remoteConversationModelSpeedForRequest,
              remoteConversationProjectPath:
                remoteConversationProjectPathForRequest,
              chatId: chat.id,
              checkpointsEnabled: settings.changeCheckpoints,
            },
          },
        );
        scrollConversationToBottom();
        void sendPromise.finally(finishStreaming).catch(() => {});
        return true;
      } catch (error) {
        useActivityStore
          .getState()
          .finish(
            submittedChatId,
            "failed",
            error instanceof Error ? error.message : "",
          );
        finishStreaming();
        throw error;
      }
    },
    [
      allModelOptions,
      chatT,
      clearError,
      chatMessages,
      isProcessing,
      handleActivateChat,
      gitGenerationModelSelection.model,
      gitGenerationModelSelection.provider,
      providerModels,
      project.id,
      resetPromptHistory,
      selectedProvider,
      selectedModelSpeed,
      selectedModelSpeedLabelForMetadata,
      selectedReasoningEffort,
      selectedReasoningLabelForMetadata,
      sendMessage,
      setChatTitleGenerating,
      settings.changeCheckpoints,
      scrollConversationToBottom,
      chat,
      updateChat,
    ],
  );

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    if (!pendingChatSubmit || !isActive || !messagesLoaded || isProcessing) {
      return;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      const nextSubmit = takePendingChatSubmit(chat.id);
      if (
        !nextSubmit ||
        (!nextSubmit.text.trim() &&
          nextSubmit.references.length === 0 &&
          !nextSubmit.files?.length)
      ) {
        return;
      }

      const restoreSubmittedMessage = () => {
        if (nextSubmit.preserveDraft)
          setPromptText((current) =>
            [current, nextSubmit.text].filter(Boolean).join("\n\n"),
          );
      };
      void handleSubmitRef
        .current(
          {
            files: nextSubmit.files ?? [],
            references: nextSubmit.references,
            text: nextSubmit.text,
          },
          nextSubmit.preserveDraft,
        )
        .then((submitted) => {
          if (!submitted) restoreSubmittedMessage();
        })
        .catch((error) => {
          restoreSubmittedMessage();
          setLocalError(
            error instanceof Error
              ? error.message
              : "Unable to send the message.",
          );
        });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [
    chat.id,
    isActive,
    isProcessing,
    messagesLoaded,
    pendingChatSubmit,
    takePendingChatSubmit,
  ]);

  const closeEditDialog = useCallback(() => {
    setEditTarget(null);
    setEditValue("");
  }, []);

  const handleEditChat = useCallback(() => {
    setEditTarget({ id: chat.id, name: chat.title });
    setEditValue(chat.title);
  }, [chat.id, chat.title]);

  const handleEditSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextName = editValue.trim();
      if (!editTarget || !nextName) {
        return;
      }

      updateChat(editTarget.id, (current) => ({
        ...current,
        title: nextName,
      }));
      closeEditDialog();
    },
    [closeEditDialog, editTarget, editValue, updateChat],
  );

  const showChatHeader = messages.length > 0 || canCloseChat;
  const canShowChatMenu = !isDraftChat || messages.length > 0;

  return (
    <>
      <div
        id={panelDomId}
        className="flex h-full min-h-0 flex-col"
        onFocusCapture={handleActivateChat}
        onPointerDownCapture={handleActivateChat}
        style={CHAT_PANEL_BACKGROUND_STYLE}
      >
        {showChatHeader ? (
          <ChatPanelHeader
            canCloseChat={canCloseChat}
            canShowChatMenu={canShowChatMenu}
            chatMenuOpen={chatMenuOpen}
            continueInTerminalDisabled={isProcessing}
            isTitleGenerating={isTitleGenerating}
            onCloseChat={onCloseChat}
            onChatMenuOpenChange={setChatMenuOpen}
            onDeleteChat={() => deleteChat(chat.id)}
            onEditChat={handleEditChat}
            onContinueInTerminal={
              canContinueInTerminal ? handleContinueInTerminal : undefined
            }
            onHeaderPointerDown={onHeaderPointerDown}
            onRenameChat={(title) =>
              updateChat(chat.id, (current) => ({ ...current, title }))
            }
            title={chat.title}
          />
        ) : null}

        <Conversation
          contextRef={conversationContextRef}
          id={conversationDomId}
          className="min-h-0 flex-1"
        >
          <ConversationContent
            id={conversationContentDomId}
            className={
              messages.length === 0
                ? "mx-auto flex min-h-full w-full max-w-[700px] flex-col px-0 pt-3"
                : "relative mx-auto block w-full max-w-[700px] px-0 pt-3"
            }
            style={{ paddingBottom: CHAT_CONTENT_BOTTOM_PADDING_PX }}
          >
            {!messagesLoaded ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <img
                  alt=""
                  className="size-16"
                  draggable={false}
                  src={dreamSvg}
                />
                <p className="font-medium text-lg">{chatT("buildAnything")}</p>
              </div>
            ) : (
              <>
                {transcriptWindow.hiddenMessageCount > 0 ? (
                  <div className="flex w-full justify-center pb-4">
                    <Button
                      onClick={handleLoadEarlierMessages}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {commonT("open")} {workspaceT("chatHistory")} (
                      {transcriptWindow.hiddenMessageCount})
                    </Button>
                  </div>
                ) : null}
                {transcriptWindow.messages.map((message, index) => {
                  const messageIndex = transcriptWindow.startIndex + index;
                  const isLastMessage = messageIndex === messages.length - 1;

                  return (
                    <div
                      className="w-full pb-4"
                      key={message.id}
                      style={
                        isLastMessage ? undefined : CHAT_HISTORY_MESSAGE_STYLE
                      }
                    >
                      <ChatMessage
                        addToolApprovalResponse={addToolApprovalResponse}
                        continueChat={continueChat}
                        expandToolCalls={settings.expandToolCalls}
                        groupToolCalls={settings.groupToolCalls}
                        isLastMessage={isLastMessage}
                        isStreaming={isStreaming}
                        message={message}
                        projectPath={project.path}
                        showReasoningSummaries={settings.showReasoningSummaries}
                      />
                    </div>
                  );
                })}
              </>
            )}
          </ConversationContent>
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 z-10"
            style={CHAT_CONVERSATION_TOP_FADE_STYLE}
          />
          {isStreaming ? null : (
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 z-10"
              style={CHAT_CONVERSATION_BOTTOM_FADE_STYLE}
            />
          )}
          <ConversationScrollButton className="z-20" />
        </Conversation>

        {localError ? (
          <ChatErrorBanner
            error={localError}
            onDismiss={() => {
              setLocalError(null);
              clearError();
            }}
          />
        ) : null}

        <ChatComposer
          agentMode={chat.agentMode}
          allModelOptions={allModelOptions}
          chatProvider={chat.provider}
          contextWindow={contextWindow}
          contextUsage={contextUsage}
          contextUsedTokens={contextUsedTokens}
          isActive={isProjectActive && messagesLoaded}
          isProcessing={isProcessing}
          isProviderInstalled={isProviderInstalled}
          modelId={modelId}
          onAgentModeChange={(agentMode) => {
            updateChat(chat.id, (current) => ({
              ...current,
              agentMode,
            }));
          }}
          onModelChange={(nextOption) => {
            updateChat(chat.id, (current) => ({
              ...current,
              model: nextOption.id,
              modelSpeed: "standard",
              provider: nextOption.provider,
              reasoningEffort: null,
              remoteConversationId: null,
              remoteConversationModel: null,
              remoteConversationModelSpeed: null,
              remoteConversationProjectPath: null,
            }));
          }}
          onModelSpeedChange={(modelSpeed) => {
            updateChat(chat.id, (current) => ({
              ...current,
              modelSpeed,
              remoteConversationId: null,
              remoteConversationModel: null,
              remoteConversationModelSpeed: null,
              remoteConversationProjectPath: null,
            }));
          }}
          onPermissionModeChange={(permissionMode) => {
            updateChat(chat.id, (current) => ({
              ...current,
              permissionMode,
            }));
          }}
          onPromptKeyDown={handlePromptKeyDown}
          onPromptTextChange={setPromptText}
          onReasoningEffortChange={(reasoningEffort) => {
            updateChat(chat.id, (current) => ({
              ...current,
              reasoningEffort:
                reasoningEffort === "medium" ? null : reasoningEffort,
            }));
          }}
          onSparklesPaletteChange={(sparklesPalette) => {
            updateChat(chat.id, (current) => ({
              ...current,
              sparklesPalette,
            }));
          }}
          onStop={stop}
          onSubmit={async (prompt) => {
            await handleSubmit(prompt);
          }}
          promptDomId={promptDomId}
          promptInputDomId={promptInputDomId}
          promptText={promptText}
          permissionMode={chat.permissionMode}
          projectPath={project.path}
          reasoningEffortOptions={reasoningEffortOptions}
          speedOptions={speedOptions}
          selectedModel={selectedModel}
          selectedModelLabel={selectedModelLabel}
          selectedModelValue={selectedModelValue}
          selectedModelSpeed={selectedModelSpeed}
          selectedModelSpeedLabel={selectedModelSpeedLabel}
          selectedProvider={selectedProvider}
          selectedReasoningEffort={selectedReasoningEffortForControl}
          selectedReasoningLabel={selectedReasoningLabel}
          sparklesPalette={chat.sparklesPalette}
          status={status}
          todoSummary={todoSummary}
        />

        <ProjectBranchFooter project={project} />
      </div>

      <EditChatDialog
        editValue={editValue}
        onClose={closeEditDialog}
        onEditValueChange={setEditValue}
        onSubmit={handleEditSubmit}
        open={editTarget !== null}
      />
    </>
  );
};
