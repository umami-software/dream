import type { UIMessage } from "ai";
import { chatIsAwaitingAnswer } from "./header/project-tab-status";

// null means no outstanding request; an empty string uses the generic label.
export function getActivityAttention(messages: UIMessage[]): string | null {
  const awaiting = chatIsAwaitingAnswer(messages);
  let detail: string | null = awaiting ? "" : null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user") break;
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        "state" in part &&
        part.state === "approval-requested" &&
        !("approval" in part && typeof part.approval?.approved === "boolean") &&
        detail === null
      )
        detail = "";
      if (
        awaiting &&
        "input" in part &&
        part.input &&
        typeof part.input === "object" &&
        "questions" in part.input
      ) {
        const questions = part.input.questions;
        if (Array.isArray(questions)) {
          const question = questions.find(
            (item) => typeof item?.question === "string",
          );
          if (question) return question.question.slice(0, 500);
        }
      }
    }
  }
  return detail;
}
