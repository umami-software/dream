import { create } from "zustand";

export type ActivityStatus =
  | "running"
  | "waiting"
  | "finished"
  | "failed"
  | "interrupted";
export interface ChatActivity {
  status: ActivityStatus;
  updatedAt: number;
  detail: string;
}

const STORAGE_KEY = "dream-agent-activity-v1";

function readActivity(): Record<string, ChatActivity> {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const result: Record<string, ChatActivity> = {};
    for (const [id, value] of Object.entries(saved)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as ChatActivity;
      if (
        !Number.isFinite(entry.updatedAt) ||
        !["running", "waiting", "finished", "failed", "interrupted"].includes(
          entry.status,
        )
      )
        continue;
      const interrupted =
        entry.status === "running" || entry.status === "waiting";
      result[id] = {
        status: interrupted ? "interrupted" : entry.status,
        updatedAt: entry.updatedAt,
        detail: interrupted
          ? ""
          : typeof entry.detail === "string"
            ? entry.detail
            : "",
      };
    }
    return result;
  } catch {
    return {};
  }
}

interface ActivityState {
  open: boolean;
  toggleOpen: () => void;
  entries: Record<string, ChatActivity>;
  start: (chatId: string) => void;
  attention: (chatId: string, detail: string | null) => void;
  finish: (
    chatId: string,
    status: "finished" | "failed" | "interrupted",
    detail?: string,
  ) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  open: false,
  toggleOpen: () => set((state) => ({ open: !state.open })),
  entries: readActivity(),
  start: (chatId) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [chatId]: {
          status: "running",
          updatedAt: Date.now(),
          detail: "",
        },
      },
    })),
  attention: (chatId, detail) =>
    set((state) => {
      const entry = state.entries[chatId];
      if (!entry || (entry.status !== "running" && entry.status !== "waiting"))
        return state;
      const status = detail === null ? "running" : "waiting";
      if (entry.status === status && entry.detail === (detail ?? ""))
        return state;
      return {
        entries: {
          ...state.entries,
          [chatId]: {
            ...entry,
            status,
            detail: detail ?? "",
            updatedAt: entry.status === status ? entry.updatedAt : Date.now(),
          },
        },
      };
    }),
  finish: (chatId, status, detail = "") =>
    set((state) => {
      const entry = state.entries[chatId];
      // A later transport cleanup must not overwrite the actual failure.
      if (entry?.status === "failed" && (status !== "failed" || !detail))
        return state;
      return {
        entries: {
          ...state.entries,
          [chatId]: {
            status,
            detail: detail.slice(0, 500),
            updatedAt: Date.now(),
          },
        },
      };
    }),
}));

useActivityStore.subscribe((state, previous) => {
  if (state.entries === previous.entries) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
  } catch {
    // Activity remains usable when local storage is unavailable.
  }
});
