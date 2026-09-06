import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input-controls";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDiffReferenceMessage,
  getFirstActiveDiffChatId,
} from "./diff-feedback";
import { useIdeStore } from "./ide-store";

export interface DiffFeedbackTarget {
  projectId: string;
  filePath: string;
  previousPath?: string | null;
}

const FEEDBACK_SELECTION_CSS = `
:host {
  --diffs-selection-base: var(--color-blue-500);
  --diffs-selection-number-fg: light-dark(var(--color-blue-800), var(--color-blue-200));
  --diffs-bg-selection-override: var(--color-blue-500);
  --diffs-bg-selection-number-override: var(--color-blue-500);
}
[data-utility-button] {
  background-color: var(--color-foreground);
  color: var(--color-background);
}
[data-line-annotation], [data-gutter-buffer='annotation'] {
  --diffs-line-bg: var(--color-background);
}
`;

export function InlineDiffFeedback({
  fileDiff,
  options,
  target,
}: {
  fileDiff: FileDiffMetadata;
  options: FileDiffProps<undefined>["options"];
  target: DiffFeedbackTarget;
}) {
  const chatT = useTranslations("chat");
  // Keep the live highlight separate from the committed comment range so the
  // form does not move or steal focus while the user is dragging.
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const [range, setRange] = useState<SelectedLineRange | null>(null);
  const [snapshot, setSnapshot] = useState(fileDiff);
  const [comment, setComment] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [createdChatId, setCreatedChatId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const diffContainer = useRef<HTMLDivElement>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const toggleId = useId();
  const [error, setError] = useState<string | null>(null);
  const allChats = useIdeStore((s) => s.chats);
  const project = useIdeStore((s) =>
    s.projects.find((p) => p.id === target.projectId),
  );
  const destination = newChat
    ? (createdChatId ?? "new")
    : getFirstActiveDiffChatId(project, allChats);
  const busy = useIdeStore((s) =>
    destination ? !!s.streamingChatIds[destination] : false,
  );
  useEffect(() => {
    if (!range) {
      setAnchor(null);
      return;
    }
    // Wait for the diff renderer to paint its controlled selection, then anchor
    // to the visually first selected gutter cell (also handles upward drags).
    const root =
      diffContainer.current?.querySelector(".dream-diff-viewer")?.shadowRoot;
    if (!root) return;
    let frame = 0;
    const updateAnchor = () => {
      const cells = Array.from(
        root?.querySelectorAll<HTMLElement>(
          "[data-column-number][data-selected-line]",
        ) ?? [],
      );
      cells.sort((a, b) => {
        const first = a.getBoundingClientRect();
        const second = b.getBoundingClientRect();
        return first.top - second.top || first.left - second.left;
      });
      setAnchor(cells[0] ?? null);
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateAnchor);
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-selected-line"],
    });
    scheduleUpdate();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [range]);

  const previewSelection = useCallback(
    (next: SelectedLineRange | null) => {
      if (range) return;
      setSelection(next);
    },
    [range],
  );
  const commitSelection = useCallback(
    (next: SelectedLineRange | null) => {
      if (range) return;
      setSelection(next);
      setRange(next);
      setSnapshot(fileDiff);
      setNewChat(false);
      setCreatedChatId(null);
      setError(null);
    },
    [range, fileDiff],
  );
  const cancel = () => {
    setRange(null);
    setAnchor(null);
    setSelection(null);
    setComment("");
    setError(null);
  };
  const submit = () => {
    if (!range || !comment.trim() || !destination || busy) return;
    setError(null);
    try {
      const text = formatDiffReferenceMessage(
        target.filePath,
        snapshot,
        range,
        comment,
        target.previousPath,
        options?.diffStyle,
      );
      const state = useIdeStore.getState();
      const project = state.projects.find((p) => p.id === target.projectId);
      if (!project || state.activeProjectId !== target.projectId)
        throw new Error("Open this project before sending a message.");
      let chatId = newChat
        ? (createdChatId ?? "new")
        : getFirstActiveDiffChatId(project, state.chats);
      if (!chatId) throw new Error("Open a chat or enable New chat.");
      if (chatId === "new") {
        const createdId = project.ui.multiChat
          ? state.addChatBeside(project.id)
          : state.addChat(project.id, undefined, { forceNew: true });
        if (!createdId) throw new Error("Unable to create a chat.");
        chatId = createdId;
        // Retry in the same new chat if loading or provider setup fails.
        setCreatedChatId(chatId);
      } else {
        const chat = state.chats.find(
          (c) =>
            c.id === chatId &&
            c.projectId === project.id &&
            c.deletedAt === null,
        );
        if (!chat) throw new Error("Choose an available chat.");
        if (state.streamingChatIds[chatId])
          throw new Error(
            "This chat is busy. Choose another chat or wait for it to finish.",
          );
        state.setActiveChatId(project.id, chatId);
      }
      if (
        !useIdeStore.getState().queueChatSubmit(chatId, {
          text,
          references: [],
          preserveDraft: true,
        })
      ) {
        throw new Error(
          "This chat already has a message in progress. Try again when it finishes.",
        );
      }
      cancel();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to send the message.",
      );
    }
  };

  return (
    <div ref={diffContainer}>
      {error && !range ? (
        <p role="alert" className="px-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <FileDiff
        className="dream-diff-viewer w-full min-w-0"
        fileDiff={range ? snapshot : fileDiff}
        options={{
          ...options,
          unsafeCSS: `${options?.unsafeCSS ?? ""}\n${FEEDBACK_SELECTION_CSS}`,
          enableLineSelection: true,
          controlledSelection: true,
          onLineSelectionStart: previewSelection,
          onLineSelectionChange: previewSelection,
          onLineSelectionEnd: commitSelection,
          onGutterUtilityClick: commitSelection,
          enableGutterUtility: !range,
        }}
        selectedLines={selection}
      />
      <Popover
        open={!!range && !!anchor}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
      >
        <PopoverContent
          anchor={anchor}
          side="left"
          align="start"
          sideOffset={12}
          className="w-96 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-lg border border-surface-300 bg-surface-50 p-0 shadow-md ring-0 dark:border-surface-700 dark:bg-surface-900"
          initialFocus={commentInput}
          finalFocus={false}
          aria-label="Chat about selected lines"
        >
          <form
            aria-label="Chat about selected lines"
            className="font-sans text-sm text-foreground"
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
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
                void submit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="relative z-10 -mx-px -mt-px flex w-[calc(100%+2px)] items-end gap-1 overflow-hidden rounded-lg border border-surface-300 bg-background py-1.5 dark:border-surface-700">
              <Textarea
                ref={commentInput}
                aria-label="Message"
                placeholder={chatT("askAnything")}
                className="min-h-0 max-h-48 min-w-0 flex-1 resize-none rounded-none border-none bg-transparent px-3 py-2 text-sm shadow-none caret-foreground focus-visible:ring-0 selection:bg-foreground/20 selection:text-foreground dark:bg-transparent"
                rows={1}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <div className="flex shrink-0 items-center self-end pr-2 pb-0.5">
                <PromptInputSubmit
                  aria-label="Send message"
                  title={busy ? "Chat busy" : "Send message"}
                  className="size-8 rounded-md bg-surface-900 text-surface-50 hover:bg-surface-800 dark:bg-surface-200 dark:text-surface-900 dark:hover:bg-surface-300"
                  disabled={!comment.trim() || !destination || busy}
                />
              </div>
            </div>
            {error ? (
              <p role="alert" className="px-3 pt-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-1 px-3 py-1.5">
              <label
                htmlFor={toggleId}
                className="flex h-7 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground"
              >
                <Switch
                  id={toggleId}
                  size="sm"
                  checked={newChat}
                  onCheckedChange={(checked) => {
                    setNewChat(checked);
                    setError(null);
                  }}
                />
                New chat
              </label>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
