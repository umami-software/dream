import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { ChatConfig } from "@/types/ide";
import { type ChatActivity, useActivityStore } from "../activity-store";
import { formatLastActiveTime } from "../activity-time";
import { PROVIDER_LABELS } from "../chat/chat-message";
import { AppShellPlaceholder } from "../ide-helpers";
import { useIdeStore } from "../ide-store";
import {
  BROWSER_PANEL_MIN_WIDTH_PX,
  CHAT_HISTORY_PANEL_MAX_WIDTH_PX,
  SLIDING_PANEL_TRANSITION,
} from "../workspace/constants";
import { WorkspaceSlidingPanel } from "../workspace/sliding-panel";

export function ActivityInbox() {
  const t = useTranslations("activity");
  const format = useFormatter();
  const locale = useLocale();
  const relativeTimeFormatter = useMemo(
    () =>
      new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }),
    [locale],
  );
  const open = useActivityStore((s) => s.open);
  const [now, setNow] = useState(() => new Date());
  const [width, setWidth] = useState(340);
  const widthRef = useRef(width);
  const toggleOpen = useActivityStore((s) => s.toggleOpen);
  const entries = useActivityStore((s) => s.entries);
  const chats = useIdeStore((s) => s.chats);
  const projects = useIdeStore((s) => s.projects);
  const activeProjectId = useIdeStore((s) => s.activeProjectId);
  const completedChatIds = useIdeStore((s) => s.completedChatIds);
  const hydrated = useIdeStore((s) => s.stateHydrated);

  const rows = useMemo(() => {
    if (!hydrated) return [];
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    return chats
      .flatMap((chat) => {
        const project = projectById.get(chat.projectId);
        if (
          chat.deletedAt !== null ||
          !project?.ui.openChatIds.includes(chat.id)
        )
          return [];
        const entry: ChatActivity | undefined = Object.hasOwn(entries, chat.id)
          ? entries[chat.id]
          : undefined;
        // Runtime timestamps change at turn boundaries, never for streamed tokens.
        const updatedAt =
          entry?.updatedAt ??
          (Date.parse(chat.updatedAt) || Date.parse(chat.createdAt) || 0);
        return [
          {
            chat,
            project,
            entry,
            updatedAt,
            status: entry?.status ?? ("idle" as const),
          },
        ];
      })
      .sort(
        (a, b) =>
          b.updatedAt - a.updatedAt || a.chat.id.localeCompare(b.chat.id),
      );
  }, [chats, entries, projects, hydrated]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  const openChat = (chat: ChatConfig) => {
    const store = useIdeStore.getState();
    store.setActiveProjectId(chat.projectId);
    store.setActiveChatId(chat.projectId, chat.id);
  };

  return (
    <WorkspaceSlidingPanel
      // Keep the exiting panel above the workspace as its reserved width closes.
      className="z-30"
      contentClassName="py-2 pl-2"
      contentMinWidth={BROWSER_PANEL_MIN_WIDTH_PX}
      minWidth={BROWSER_PANEL_MIN_WIDTH_PX}
      maxWidth={CHAT_HISTORY_PANEL_MAX_WIDTH_PX}
      onHandleDoubleClick={toggleOpen}
      onResizeEnd={setWidth}
      open={open}
      reserveSpace
      side="left"
      transition={SLIDING_PANEL_TRANSITION}
      width={width}
      widthRef={widthRef}
    >
      <aside
        id="activity-panel"
        aria-label={t("title")}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-surface-300 bg-background text-sm text-foreground shadow-md dark:border-surface-700"
      >
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-3 py-3">
          <h2 className="font-medium">{t("title")}</h2>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 px-2 pb-2">
            {rows.length === 0 ? (
              <AppShellPlaceholder message={t("empty")} />
            ) : (
              <ul className="space-y-1">
                {rows.map(({ chat, project, entry, updatedAt, status }) => {
                  const selected =
                    activeProjectId === project.id &&
                    project.ui.activeChatId === chat.id;
                  return (
                    <li
                      key={chat.id}
                      className={cn(
                        "group relative min-w-0 rounded-md border border-transparent",
                        selected
                          ? "bg-muted"
                          : "hover:bg-surface-50 dark:hover:bg-surface-900",
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full gap-2.5 rounded-[inherit] px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => openChat(chat)}
                        aria-label={`${t("open")}: ${chat.title}`}
                        aria-current={selected ? true : undefined}
                      >
                        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                          <StatusDot
                            aria-label={t(status)}
                            title={t(status)}
                            color={
                              status === "running"
                                ? "blue"
                                : status === "finished"
                                  ? "green"
                                  : "amber"
                            }
                            pulse={status === "running" || status === "waiting"}
                            className={cn(
                              (status === "idle" ||
                                (status === "finished" &&
                                  !completedChatIds[chat.id])) &&
                                "bg-muted-foreground/40",
                              status === "failed" && "bg-destructive",
                            )}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {chat.title}
                            </span>
                            <time
                              className="shrink-0 text-xs text-muted-foreground"
                              dateTime={new Date(updatedAt).toISOString()}
                              title={format.dateTime(updatedAt, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            >
                              {formatLastActiveTime(
                                updatedAt,
                                relativeTimeFormatter,
                                now.getTime(),
                              )}
                            </time>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {project.name}
                            {project.worktree
                              ? ` · ${project.worktree.branch}`
                              : ""}{" "}
                            · {PROVIDER_LABELS[chat.provider]}
                          </p>
                          <Badge
                            variant={
                              status === "failed" ? "destructive" : "secondary"
                            }
                            className={cn(
                              "mt-1.5",
                              status === "running"
                                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                : status === "finished"
                                  ? "bg-success-highlight/10 text-success-highlight"
                                  : status === "failed"
                                    ? "text-destructive"
                                    : status === "waiting" ||
                                        status === "interrupted"
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground",
                            )}
                          >
                            {t(status)}
                          </Badge>
                          {entry?.detail ? (
                            <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">
                              {entry.detail}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </ScrollArea>
      </aside>
    </WorkspaceSlidingPanel>
  );
}
