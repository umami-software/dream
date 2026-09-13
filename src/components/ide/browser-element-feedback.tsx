import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input-controls";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createBrowserFeedbackAttachment,
  formatElementFeedbackMessage,
  formatElementSource,
} from "./browser-feedback";
import type { InspectedElement } from "./browser-inspector-script";
import { getFirstActiveDiffChatId } from "./diff-feedback";
import { queueFeedbackSubmit, resolveFeedbackChatId } from "./feedback-chat";
import { useIdeStore } from "./ide-store";

export interface BrowserElementSelection {
  element: InspectedElement;
  /** PNG data URL of the element, when the capture succeeded. */
  imageDataUrl: string | null;
  tabId: string;
}

export interface BrowserElementFeedbackProps {
  onClose: () => void;
  projectId: string;
  selection: BrowserElementSelection;
}

/** Comment form for a picked element, docked over the bottom of the preview. */
export function BrowserElementFeedback({
  onClose,
  projectId,
  selection,
}: BrowserElementFeedbackProps) {
  const browserT = useTranslations("browser");
  const chatT = useTranslations("chat");
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const toggleId = useId();
  const [comment, setComment] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [createdChatId, setCreatedChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allChats = useIdeStore((s) => s.chats);
  const project = useIdeStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );
  const destination = newChat
    ? (createdChatId ?? "new")
    : getFirstActiveDiffChatId(project, allChats);
  const busy = useIdeStore((s) =>
    destination ? !!s.streamingChatIds[destination] : false,
  );
  const canSend = !!comment.trim() && !!destination && !busy;
  const { element } = selection;
  const component = element.component;
  const source = formatElementSource(component?.source ?? null);

  useEffect(() => {
    commentInput.current?.focus();
  }, []);

  const submit = () => {
    if (!canSend) return;
    setError(null);
    try {
      const text = formatElementFeedbackMessage({ comment, element });
      const target = resolveFeedbackChatId({
        createdChatId,
        newChat,
        projectId,
      });
      // Retry in the same new chat if loading or provider setup fails.
      if (target.created) setCreatedChatId(target.chatId);
      queueFeedbackSubmit(target.chatId, {
        files: selection.imageDataUrl
          ? [createBrowserFeedbackAttachment(selection.imageDataUrl)]
          : [],
        preserveDraft: true,
        references: [],
        text,
      });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to send the message.",
      );
    }
  };

  return (
    <form
      aria-label={browserT("sendToChat")}
      className="absolute right-3 bottom-3 left-3 z-20 rounded-lg border border-surface-300 bg-surface-50 p-2 font-sans text-foreground text-sm shadow-md dark:border-surface-700 dark:bg-surface-900"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing &&
          (event.target === commentInput.current ||
            event.metaKey ||
            event.ctrlKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-2 px-1 pb-2">
        {selection.imageDataUrl ? (
          <img
            alt=""
            className="max-h-16 max-w-28 shrink-0 rounded border border-surface-200 object-contain dark:border-surface-800"
            draggable={false}
            src={selection.imageDataUrl}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <code className="truncate rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-blue-700 text-xs dark:text-blue-300">
              {element.name}
            </code>
            <span className="shrink-0 text-muted-foreground text-xs">
              {Math.round(element.rect.width)}×{Math.round(element.rect.height)}
            </span>
          </div>
          {component?.components.length ? (
            <div
              className="mt-1 truncate text-muted-foreground text-xs"
              title={component.components.join(" < ")}
            >
              {component.components.join(" ‹ ")}
            </div>
          ) : null}
          {source ? (
            <div
              className="truncate font-mono text-[11px] text-muted-foreground"
              title={source}
            >
              {source}
            </div>
          ) : null}
        </div>
        <button
          aria-label={browserT("feedbackCancel")}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
          title={browserT("feedbackCancel")}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-end gap-1 overflow-hidden rounded-lg border border-surface-300 bg-background py-1.5 dark:border-surface-700">
        <Textarea
          aria-label={chatT("askAnything")}
          className="min-h-0 max-h-40 min-w-0 flex-1 resize-none rounded-none border-none bg-transparent px-3 py-2 text-sm shadow-none caret-foreground focus-visible:ring-0 selection:bg-foreground/20 selection:text-foreground dark:bg-transparent"
          onChange={(event) => setComment(event.target.value)}
          placeholder={chatT("askAnything")}
          ref={commentInput}
          rows={1}
          value={comment}
        />
        <div className="flex shrink-0 items-center self-end pr-2 pb-0.5">
          <PromptInputSubmit
            aria-label={browserT("sendToChat")}
            className="size-8 rounded-md bg-surface-900 text-surface-50 hover:bg-surface-800 dark:bg-surface-200 dark:text-surface-900 dark:hover:bg-surface-300"
            disabled={!canSend}
            title={busy ? browserT("feedbackChatBusy") : browserT("sendToChat")}
          />
        </div>
      </div>
      {error ? (
        <p className="px-1 pt-2 text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-1 px-1 pt-1.5">
        <label
          className="flex h-7 cursor-pointer items-center gap-2 font-medium text-muted-foreground text-xs"
          htmlFor={toggleId}
        >
          <Switch
            checked={newChat}
            id={toggleId}
            onCheckedChange={(checked) => {
              setNewChat(checked);
              setError(null);
            }}
            size="sm"
          />
          {browserT("feedbackNewChat")}
        </label>
      </div>
    </form>
  );
}
