import type { PendingChatSubmit } from "@/types/ide";
import { getFirstActiveDiffChatId } from "./diff-feedback";
import { useIdeStore } from "./ide-store";

export interface FeedbackChatTarget {
  /** Chat created by a previous attempt, reused so retries land in one chat. */
  createdChatId: string | null;
  newChat: boolean;
  projectId: string;
}

/**
 * Resolves (creating if needed) the chat a feedback message should go to and
 * makes it active. Throws user-facing errors when no chat can receive it.
 */
export function resolveFeedbackChatId({
  createdChatId,
  newChat,
  projectId,
}: FeedbackChatTarget): { chatId: string; created: boolean } {
  const state = useIdeStore.getState();
  const project = state.projects.find((p) => p.id === projectId);
  if (!project || state.activeProjectId !== projectId)
    throw new Error("Open this project before sending a message.");
  const chatId = newChat
    ? (createdChatId ?? "new")
    : getFirstActiveDiffChatId(project, state.chats);
  if (!chatId) throw new Error("Open a chat or enable New chat.");
  if (chatId === "new") {
    const createdId = project.ui.multiChat
      ? state.addChatBeside(project.id)
      : state.addChat(project.id, undefined, { forceNew: true });
    if (!createdId) throw new Error("Unable to create a chat.");
    return { chatId: createdId, created: true };
  }
  const chat = state.chats.find(
    (c) =>
      c.id === chatId && c.projectId === project.id && c.deletedAt === null,
  );
  if (!chat) throw new Error("Choose an available chat.");
  if (state.streamingChatIds[chatId])
    throw new Error(
      "This chat is busy. Choose another chat or wait for it to finish.",
    );
  state.setActiveChatId(project.id, chatId);
  return { chatId, created: false };
}

export function queueFeedbackSubmit(
  chatId: string,
  submission: PendingChatSubmit,
) {
  if (!useIdeStore.getState().queueChatSubmit(chatId, submission)) {
    throw new Error(
      "This chat already has a message in progress. Try again when it finishes.",
    );
  }
}
