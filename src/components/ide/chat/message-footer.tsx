import type { LanguageModelUsage, UIMessage } from "ai";
import { CheckIcon, CopyIcon, HistoryIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ProjectReference } from "@/types/ide";
import { CheckpointChangesDialog } from "./checkpoint-changes-dialog";
import {
  ContinueChatPopover,
  type ContinueChatPopoverContext,
} from "./continue-chat-popover";
import { getMessageText } from "./message-content";

export type ChatMessageMetadata = {
  checkpointId?: string;
  completedAt?: string;
  contextWindow?: number;
  createdAt?: string;
  model?: string;
  modelLabel?: string;
  modelSpeed?: string;
  modelSpeedLabel?: string;
  projectReferences?: ProjectReference[];
  reasoningEffort?: string;
  reasoningLabel?: string;
  remoteConversationId?: string;
  remoteConversationModel?: string;
  remoteConversationModelSpeed?: string;
  remoteConversationProjectPath?: string;
  startedAt?: string;
  usage?: LanguageModelUsage;
};

type FooterItem = {
  id: "model" | "reasoning" | "speed" | "time" | "duration";
  text: string;
  shimmer: boolean;
};

const parseMessageTime = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

type FormatDurationUnit = (
  value: number,
  unit: "day" | "hour" | "minute" | "second",
) => string;

const formatRunningDuration = (
  startedAt: number,
  now: number,
  formatUnit: FormatDurationUnit,
) => {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [
      formatUnit(hours, "hour"),
      formatUnit(minutes, "minute"),
      formatUnit(seconds, "second"),
    ].join(" ");
  }

  if (minutes > 0) {
    return [formatUnit(minutes, "minute"), formatUnit(seconds, "second")].join(
      " ",
    );
  }

  return formatUnit(seconds, "second");
};

const getMessageTimestamp = (value: string | undefined) =>
  parseMessageTime(value)?.getTime() ?? null;

const isClaudeMessageMetadata = (metadata: ChatMessageMetadata | undefined) => {
  const modelLabel = metadata?.modelLabel?.trim().toLowerCase() ?? "";
  const model = metadata?.model?.trim().toLowerCase() ?? "";

  return (
    modelLabel.startsWith("claude") ||
    model.startsWith("claude") ||
    model.startsWith("opus") ||
    model.startsWith("sonnet") ||
    model.startsWith("haiku")
  );
};

export type MessageCheckpointContext = {
  chatId: string;
  isProcessing: boolean;
  projectId: string;
  projectPath: string;
};

export const MessageHoverFooter = ({
  checkpoint,
  continueChat,
  isRunning = false,
  message,
}: {
  checkpoint?: MessageCheckpointContext;
  continueChat?: ContinueChatPopoverContext;
  isRunning?: boolean;
  message: UIMessage;
}) => {
  const chatT = useTranslations("chat");
  const checkpointsT = useTranslations("checkpoints");
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const format = useFormatter();
  const formatDurationUnit: FormatDurationUnit = (value, unit) =>
    format.number(value, { style: "unit", unit, unitDisplay: "narrow" });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fallbackStartedAt] = useState(() => Date.now());
  const metadata = message.metadata as ChatMessageMetadata | undefined;
  const modelLabel = metadata?.modelLabel;
  const modelSpeedLabel = isClaudeMessageMetadata(metadata)
    ? undefined
    : metadata?.modelSpeedLabel;
  const reasoningLabel =
    metadata?.reasoningLabel &&
    metadata.reasoningLabel !== metadata.reasoningEffort
      ? metadata.reasoningLabel
      : undefined;
  const durationStartedAt =
    getMessageTimestamp(metadata?.startedAt) ??
    getMessageTimestamp(metadata?.createdAt);
  const startedAt =
    durationStartedAt ??
    getMessageTimestamp(metadata?.createdAt) ??
    fallbackStartedAt;
  const completedAt = getMessageTimestamp(metadata?.completedAt);
  const messageDate = parseMessageTime(
    message.role === "assistant" ? metadata?.completedAt : metadata?.createdAt,
  );
  const time = isRunning
    ? chatT("runningFor", {
        duration: formatRunningDuration(startedAt, now, formatDurationUnit),
      })
    : messageDate
      ? format.dateTime(messageDate, { hour: "numeric", minute: "2-digit" })
      : null;
  const duration =
    !isRunning && durationStartedAt !== null && completedAt !== null
      ? chatT("ranFor", {
          duration: formatRunningDuration(
            durationStartedAt,
            completedAt,
            formatDurationUnit,
          ),
        })
      : null;
  const text = getMessageText(message);
  const continueChatContext =
    message.role === "assistant" ? continueChat : undefined;
  const checkpointId =
    message.role === "assistant" && checkpoint && metadata?.checkpointId
      ? metadata.checkpointId
      : null;
  const footerItems = [
    { id: "model", text: modelLabel, shimmer: false },
    { id: "reasoning", text: reasoningLabel, shimmer: false },
    { id: "speed", text: modelSpeedLabel, shimmer: false },
    { id: "time", text: time, shimmer: isRunning },
    { id: "duration", text: duration, shimmer: false },
  ].filter((item): item is FooterItem => !!item.text);
  const positionClassName =
    message.role === "user"
      ? "ml-auto justify-end text-right"
      : "mr-auto justify-start text-left";

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning]);

  const copyMessage = useCallback(async () => {
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [text]);

  if (
    footerItems.length === 0 &&
    !text &&
    !continueChatContext &&
    !checkpointId
  ) {
    return null;
  }

  return (
    <div
      className={`${positionClassName} pointer-events-none flex min-h-6 max-w-full items-center gap-2 text-muted-foreground text-xs`}
    >
      {footerItems.length > 0 ? (
        <span>
          {footerItems.map((item, i) => (
            <Fragment key={item.id}>
              {i > 0 ? " · " : null}
              {item.shimmer ? (
                <Shimmer as="span" duration={2}>
                  {item.text}
                </Shimmer>
              ) : (
                item.text
              )}
            </Fragment>
          ))}
        </span>
      ) : null}
      {text && !isRunning ? (
        <button
          aria-label={chatT("copyMessage")}
          className="pointer-events-auto rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => void copyMessage()}
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      ) : null}
      {!isRunning && checkpointId && checkpoint ? (
        <>
          <button
            aria-label={checkpointsT("viewTurnChanges")}
            className="pointer-events-auto rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setCheckpointOpen(true)}
            title={checkpointsT("viewTurnChanges")}
            type="button"
          >
            <HistoryIcon className="size-3.5" />
          </button>
          {checkpointOpen ? (
            <CheckpointChangesDialog
              chatId={checkpoint.chatId}
              checkpointId={checkpointId}
              disabled={checkpoint.isProcessing}
              onOpenChange={setCheckpointOpen}
              open={checkpointOpen}
              projectId={checkpoint.projectId}
              projectPath={checkpoint.projectPath}
            />
          ) : null}
        </>
      ) : null}
      {!isRunning && continueChatContext ? (
        <ContinueChatPopover {...continueChatContext} messageId={message.id} />
      ) : null}
    </div>
  );
};

export const addMetadataToMessage = (
  currentMessages: UIMessage[],
  messageId: string,
  metadata: ChatMessageMetadata,
) => {
  let changed = false;
  const nextMessages = currentMessages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    changed = true;
    return {
      ...message,
      metadata: {
        ...metadata,
        ...((message.metadata as Record<string, unknown> | undefined) ?? {}),
      },
    };
  });

  return changed ? nextMessages : currentMessages;
};
