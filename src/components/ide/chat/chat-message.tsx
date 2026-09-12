import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { memo, type ReactNode } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import type { AiProvider } from "@/types/ide";
import { ChipAnimateProvider } from "../assistant-message/shared";
import { AssistantMessagePart } from "../assistant-message-part";
import {
  isChipToolPart,
  isRedundantDirectWebToolSearchPart,
} from "../assistant-message-tools";
import { CollapsibleUserMessage } from "./collapsible-user-message";
import {
  ContextCompactionMessage,
  getContextCompactionState,
} from "./context-compaction";
import type { ContinueChatPopoverContext } from "./continue-chat-popover";
import { UserMessageContent } from "./message-content";
import { MessageHoverFooter } from "./message-footer";
import { isTodoListPart } from "./todo-list";
import {
  getMessagePartKey,
  type ToolApprovalResponder,
  ToolCallGroup,
  ToolChipRow,
} from "./tool-call-groups";

export type EditTarget = {
  id: string;
  name: string;
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok Build",
};

export const CHAT_STREAM_UPDATE_THROTTLE_MS = 50;

export const CHAT_CONTENT_BOTTOM_PADDING_PX = 88;

export const scrollElementToChatBottom = (element: HTMLElement) => {
  const targetScrollTop = element.scrollHeight - 1 - element.clientHeight;
  element.scrollTop = Math.max(targetScrollTop, 0);
};

export { PromptAttachments } from "./message-content";
export {
  addMetadataToMessage,
  type ChatMessageMetadata,
} from "./message-footer";
export type { ToolApprovalResponder } from "./tool-call-groups";

type ToolChipItem = {
  index: number;
  part: UIMessage["parts"][number];
};

type ToolChipRenderContext = {
  addToolApprovalResponse: ToolApprovalResponder;
  expandToolCalls: boolean;
  messageParts: UIMessage["parts"];
  messageId: string;
  projectPath: string;
};

type ChatMessageProps = {
  addToolApprovalResponse: ToolApprovalResponder;
  continueChat: ContinueChatPopoverContext;
  expandToolCalls: boolean;
  groupToolCalls: boolean;
  isLastMessage: boolean;
  isStreaming: boolean;
  message: UIMessage;
  projectPath: string;
  showReasoningSummaries: boolean;
};

export const ChatMessage = memo(
  ({
    addToolApprovalResponse,
    continueChat,
    expandToolCalls,
    groupToolCalls,
    isLastMessage,
    isStreaming,
    message,
    projectPath,
    showReasoningSummaries,
  }: ChatMessageProps) => {
    const uiT = useTranslations("ui");

    if (message.role === "user") {
      return (
        <Message className="relative" from="user">
          <MessageContent>
            <CollapsibleUserMessage>
              <UserMessageContent message={message} projectPath={projectPath} />
            </CollapsibleUserMessage>
          </MessageContent>
          <MessageHoverFooter continueChat={continueChat} message={message} />
        </Message>
      );
    }

    const sourceParts = message.parts.filter(
      (part) => part.type === "source-url" || part.type === "source-document",
    );
    const nonSourceParts = message.parts.filter(
      (part) => part.type !== "source-url" && part.type !== "source-document",
    );

    const isActivelyStreaming = isStreaming && isLastMessage;

    return (
      <ChipAnimateProvider value={isActivelyStreaming}>
        <Message className="relative" from={message.role}>
          {sourceParts.length > 0 ? (
            <Sources>
              <SourcesTrigger count={sourceParts.length} />
              <SourcesContent>
                {sourceParts.map((part) => {
                  if (part.type === "source-url") {
                    return (
                      <Source
                        href={part.url}
                        key={`${message.id}-source-url-${part.url}`}
                        title={part.url}
                      />
                    );
                  }
                  if (part.type === "source-document") {
                    const title =
                      part.title ?? part.filename ?? uiT("document");
                    return (
                      <Source
                        key={`${message.id}-source-document-${title}`}
                        title={title}
                      />
                    );
                  }
                  return null;
                })}
              </SourcesContent>
            </Sources>
          ) : null}
          <MessageContent className="w-full gap-3">
            {(() => {
              const elements: ReactNode[] = [];
              const toolChipContext: ToolChipRenderContext = {
                addToolApprovalResponse,
                expandToolCalls,
                messageParts: nonSourceParts,
                messageId: message.id,
                projectPath,
              };
              let chipGroup: ToolChipItem[] = [];

              const flushChipGroup = () => {
                if (chipGroup.length === 0) return;
                const group = chipGroup;
                elements.push(
                  groupToolCalls ? (
                    <ToolCallGroup
                      context={toolChipContext}
                      group={group}
                      key={`chip-group-${group[0].index}`}
                    />
                  ) : (
                    <ToolChipRow
                      context={toolChipContext}
                      group={group}
                      key={`chip-group-${group[0].index}`}
                    />
                  ),
                );
                chipGroup = [];
              };

              const isInvisiblePart = (
                part: (typeof nonSourceParts)[number],
                partIndex: number,
              ) => {
                if (isTodoListPart(part)) return true;
                if (isRedundantDirectWebToolSearchPart(part)) return true;
                if (part.type === "step-start") return true;
                if (
                  part.type === "reasoning" &&
                  "text" in part &&
                  typeof part.text === "string" &&
                  part.text.trim().length === 0 &&
                  !(
                    isStreaming &&
                    isLastMessage &&
                    partIndex === nonSourceParts.length - 1
                  )
                )
                  return true;
                if (
                  part.type === "text" &&
                  "text" in part &&
                  typeof part.text === "string" &&
                  part.text.trim().length === 0
                )
                  return true;
                return false;
              };

              for (let i = 0; i < nonSourceParts.length; i++) {
                const part = nonSourceParts[i];
                if (isInvisiblePart(part, i)) {
                } else if (isChipToolPart(part)) {
                  chipGroup.push({ part, index: i });
                } else {
                  flushChipGroup();
                  const contextCompactionState =
                    getContextCompactionState(part);
                  const isLastPart = i === nonSourceParts.length - 1;
                  const isPartStreaming =
                    isStreaming && isLastMessage && isLastPart;
                  elements.push(
                    contextCompactionState ? (
                      <ContextCompactionMessage
                        key={getMessagePartKey(
                          message.id,
                          part as Record<string, unknown>,
                          i,
                        )}
                        state={contextCompactionState}
                      />
                    ) : (
                      <AssistantMessagePart
                        key={getMessagePartKey(
                          message.id,
                          part as Record<string, unknown>,
                          i,
                        )}
                        isStreaming={isPartStreaming}
                        onToolApproval={addToolApprovalResponse}
                        part={part}
                        projectPath={projectPath}
                        showReasoningSummaries={showReasoningSummaries}
                      />
                    ),
                  );
                }
              }

              flushChipGroup();
              return elements;
            })()}
          </MessageContent>
          <MessageHoverFooter
            checkpoint={{
              chatId: continueChat.chat.id,
              isProcessing: continueChat.isProcessing,
              projectId: continueChat.chat.projectId,
              projectPath,
            }}
            continueChat={continueChat}
            isRunning={isActivelyStreaming}
            message={message}
          />
        </Message>
      </ChipAnimateProvider>
    );
  },
  (prev: ChatMessageProps, next: ChatMessageProps) =>
    prev.message === next.message &&
    prev.continueChat === next.continueChat &&
    prev.expandToolCalls === next.expandToolCalls &&
    prev.groupToolCalls === next.groupToolCalls &&
    prev.isLastMessage === next.isLastMessage &&
    prev.isStreaming === next.isStreaming &&
    prev.projectPath === next.projectPath &&
    prev.showReasoningSummaries === next.showReasoningSummaries &&
    prev.addToolApprovalResponse === next.addToolApprovalResponse,
);

ChatMessage.displayName = "ChatMessage";
