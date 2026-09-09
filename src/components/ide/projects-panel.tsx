import { Archive, FolderTree, FolderX, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SEARCH_INPUT_GROUP_CLASS_NAME } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type {
  ChatConfig,
  ProjectConfig,
  ProjectGitWorktreeInfo,
  ProjectGitWorktreesResponse,
} from "@/types/ide";
import { formatLastActiveTime } from "./activity-time";
import { normalizeProjectPathKey } from "./ide-state";
import { useIdeStore } from "./ide-store";

const useAppManagedWorktrees = (projectPath: string, refreshKey: number) => {
  const [worktrees, setWorktrees] = useState<ProjectGitWorktreeInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    const loadWorktrees = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/project-git-worktrees", {
          body: JSON.stringify({ projectPath }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: abortController.signal,
        });
        if (!response.ok) {
          setWorktrees([]);
          return;
        }

        const payload = (await response.json()) as ProjectGitWorktreesResponse;
        if (abortController.signal.aborted) {
          return;
        }

        setWorktrees(
          payload.worktrees
            .filter((worktree) => worktree.appManaged && !worktree.bare)
            .sort((left, right) =>
              (left.branch ?? left.path).localeCompare(
                right.branch ?? right.path,
              ),
            ),
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setWorktrees([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void refreshKey;
    void loadWorktrees();

    return () => abortController.abort();
  }, [projectPath, refreshKey]);

  return { loading, worktrees };
};

export const ProjectSidebar = ({
  className,
  onChatSelect,
  project,
}: {
  className?: string;
  onChatSelect?: () => void;
  project: ProjectConfig;
}) => {
  const locale = useLocale();
  const commonT = useTranslations("common");
  const projectsT = useTranslations("projects");
  const worktreeT = useTranslations("worktrees");
  const relativeTimeFormatter = useMemo(
    () =>
      new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }),
    [locale],
  );
  const allChats = useIdeStore((s) => s.chats);
  const projectUi = useIdeStore(
    (s) => s.projects.find((item) => item.id === project.id)?.ui ?? project.ui,
  );
  const setActiveChatId = useIdeStore((s) => s.setActiveChatId);
  const streamingChatIds = useIdeStore((s) => s.streamingChatIds);
  const completedChatIds = useIdeStore((s) => s.completedChatIds);
  const titleGeneratingChatIds = useIdeStore((s) => s.titleGeneratingChatIds);
  const deleteChat = useIdeStore((s) => s.deleteChat);
  const addProject = useIdeStore((s) => s.addProject);
  const removeWorktreeProject = useIdeStore((s) => s.removeWorktreeProject);
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[project.id] ?? 0,
  );
  const { loading: worktreesLoading, worktrees } = useAppManagedWorktrees(
    project.path,
    gitRefreshKey,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [removingWorktreePath, setRemovingWorktreePath] = useState<
    string | null
  >(null);
  const [pendingRemoveWorktree, setPendingRemoveWorktree] =
    useState<ProjectGitWorktreeInfo | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const activeProjectChats = useMemo<ChatConfig[]>(() => {
    return allChats
      .filter(
        (chat) =>
          chat.projectId === project.id &&
          chat.deletedAt === null &&
          chat.messageCount > 0,
      )
      .sort((left, right) => {
        const leftUpdated = Date.parse(left.updatedAt);
        const rightUpdated = Date.parse(right.updatedAt);
        if (Number.isNaN(leftUpdated) || Number.isNaN(rightUpdated)) {
          return right.title.localeCompare(left.title);
        }

        return rightUpdated - leftUpdated;
      });
  }, [allChats, project.id]);

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return activeProjectChats;
    }

    return activeProjectChats.filter((chat) =>
      chat.title.toLowerCase().includes(query),
    );
  }, [activeProjectChats, searchQuery]);

  const activeChatId = projectUi.activeChatId;

  const handleChatSelect = useCallback(
    (chatId: string) => {
      setActiveChatId(project.id, chatId);
    },
    [project.id, setActiveChatId],
  );

  const handleWorktreeSelect = useCallback(
    (worktreePath: string) => {
      addProject(worktreePath);
      onChatSelect?.();
    },
    [addProject, onChatSelect],
  );

  const handleRemoveWorktree = useCallback(async () => {
    if (!pendingRemoveWorktree) {
      return;
    }

    setRemovingWorktreePath(pendingRemoveWorktree.path);
    setWorktreeError(null);
    try {
      await removeWorktreeProject({
        force: false,
        mainWorktreePath: project.path,
        worktreePath: pendingRemoveWorktree.path,
      });
      setPendingRemoveWorktree(null);
    } catch (error) {
      setWorktreeError(
        error instanceof Error ? error.message : worktreeT("unableToRemove"),
      );
    } finally {
      bumpProjectGitRefreshKey(project.id);
      setRemovingWorktreePath(null);
    }
  }, [
    bumpProjectGitRefreshKey,
    pendingRemoveWorktree,
    project.id,
    project.path,
    removeWorktreeProject,
    worktreeT,
  ]);

  const activeProjectPathKey = normalizeProjectPathKey(project.path);
  const pendingRemoveWorktreeLabel =
    pendingRemoveWorktree?.branch ??
    pendingRemoveWorktree?.path ??
    worktreeT("worktree");
  const isRemovingPendingWorktree =
    !!pendingRemoveWorktree &&
    removingWorktreePath === pendingRemoveWorktree.path;

  return (
    <div
      id="projects-panel"
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-surface-300 dark:border-surface-700 bg-background shadow-md",
        className,
      )}
    >
      <div className="px-3 py-3">
        <p className="font-medium text-sm">{projectsT("chatHistory")}</p>
        <InputGroup className={cn("mt-2", SEARCH_INPUT_GROUP_CLASS_NAME)}>
          <InputGroupInput
            className="text-sm"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={projectsT("searchHistory")}
            value={searchQuery}
          />
          <InputGroupAddon>
            <Search className="size-4 shrink-0 opacity-50" />
          </InputGroupAddon>
        </InputGroup>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-2 pb-3">
          {worktrees.length > 0 || worktreesLoading ? (
            <section className="space-y-1">
              <div className="flex items-center gap-2 px-1 font-medium text-muted-foreground text-sm">
                <FolderTree className="size-3.5" />
                {worktreeT("worktrees")}
              </div>
              {worktrees.map((worktree) => {
                const isActiveWorktree =
                  normalizeProjectPathKey(worktree.path) ===
                  activeProjectPathKey;
                const removing = removingWorktreePath === worktree.path;

                return (
                  <div
                    className={cn(
                      "group relative min-w-0 rounded-md border",
                      isActiveWorktree
                        ? "border-border bg-surface-50 dark:bg-surface-900"
                        : "border-transparent hover:bg-surface-50 dark:hover:bg-surface-900",
                    )}
                    key={worktree.path}
                  >
                    <button
                      className="w-full rounded-[inherit] px-3 py-2 text-left"
                      onClick={(event) => {
                        handleWorktreeSelect(worktree.path);
                        if (event.detail > 0) {
                          event.currentTarget.blur();
                        }
                      }}
                      type="button"
                    >
                      <div className="flex min-w-0 items-center gap-2 pr-9">
                        <FolderTree className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm leading-5">
                            {worktree.branch ?? worktreeT("detachedWorktree")}
                          </p>
                          <p className="truncate text-muted-foreground text-sm">
                            {worktree.path}
                          </p>
                        </div>
                      </div>
                    </button>
                    <div className="-translate-y-1/2 absolute top-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        aria-label={worktreeT("removeNamedWorktree", {
                          name: worktree.branch ?? worktree.path,
                        })}
                        className="size-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-destructive"
                        disabled={removing}
                        onClick={(event) => {
                          event.stopPropagation();
                          setWorktreeError(null);
                          setPendingRemoveWorktree(worktree);
                        }}
                        size="icon-sm"
                        title={worktreeT("removeWorktree")}
                        type="button"
                        variant="ghost"
                      >
                        {removing ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <FolderX className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {worktreeError ? (
                <p className="px-2 text-destructive text-sm">{worktreeError}</p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-1">
            {filteredChats.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center p-4 text-center text-muted-foreground text-sm">
                <p>
                  {searchQuery.trim()
                    ? projectsT("noMatchingChats")
                    : projectsT("noChatsForProject")}
                </p>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const isActiveChat = chat.id === activeChatId;
                const isOpenChat = projectUi.openChatIds.includes(chat.id);
                const isStreaming = !!streamingChatIds[chat.id];
                const isTitleGenerating = !!titleGeneratingChatIds[chat.id];
                const isCompleted =
                  Boolean(completedChatIds[chat.id]) &&
                  chat.id !== activeChatId;
                const lastActiveAt = chat.updatedAt || chat.createdAt;
                const statusIndicator = isStreaming ? (
                  <StatusDot
                    aria-label={projectsT("chatStreaming")}
                    color="blue"
                  />
                ) : isCompleted ? (
                  <StatusDot
                    aria-label={projectsT("chatFinished")}
                    color="green"
                  />
                ) : isTitleGenerating ? (
                  <Spinner className="size-3 shrink-0" />
                ) : null;

                return (
                  <div
                    className={cn(
                      "group relative min-w-0 rounded-md border border-transparent",
                      isActiveChat || isOpenChat || isStreaming
                        ? "bg-muted"
                        : "hover:bg-surface-50 dark:hover:bg-surface-900",
                    )}
                    key={chat.id}
                  >
                    <button
                      className="w-full rounded-[inherit] px-3 py-2 text-left"
                      onClick={(event) => {
                        handleChatSelect(chat.id);
                        onChatSelect?.();
                        if (event.detail > 0) {
                          event.currentTarget.blur();
                        }
                      }}
                      type="button"
                    >
                      <div className="flex min-w-0 items-center gap-2 pr-12">
                        {statusIndicator ? (
                          <div className="flex size-4 shrink-0 items-center justify-center">
                            {statusIndicator}
                          </div>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="min-w-0 truncate text-sm leading-5">
                            {chat.title}
                          </p>
                        </div>
                      </div>
                      <span className="-translate-y-1/2 absolute top-1/2 right-3 text-right text-muted-foreground text-xs group-hover:opacity-0 group-focus-within:opacity-0">
                        {formatLastActiveTime(
                          lastActiveAt,
                          relativeTimeFormatter,
                        )}
                      </span>
                    </button>
                    <div className="-translate-y-1/2 absolute top-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        aria-label={projectsT("archiveNamedChat", {
                          name: chat.title,
                        })}
                        className="size-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteChat(chat.id);
                        }}
                        size="icon-sm"
                        title={projectsT("archiveChat")}
                        type="button"
                        variant="ghost"
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </ScrollArea>
      <Dialog
        onOpenChange={(open) => {
          if (open || isRemovingPendingWorktree) {
            return;
          }

          setPendingRemoveWorktree(null);
        }}
        open={!!pendingRemoveWorktree}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{worktreeT("removeWorktree")}</DialogTitle>
            <DialogDescription>
              {worktreeT.rich("removeDescription", {
                name: pendingRemoveWorktreeLabel,
                strong: (chunks) => (
                  <span className="break-all font-medium text-foreground">
                    {chunks}
                  </span>
                ),
              })}
            </DialogDescription>
          </DialogHeader>
          {worktreeError ? (
            <p className="min-w-0 whitespace-pre-wrap break-words rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive text-sm">
              {worktreeError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isRemovingPendingWorktree}
              onClick={() => setPendingRemoveWorktree(null)}
              type="button"
              variant="outline"
            >
              {commonT("cancel")}
            </Button>
            <Button
              disabled={isRemovingPendingWorktree}
              onClick={() => {
                void handleRemoveWorktree();
              }}
              variant="destructive"
            >
              {isRemovingPendingWorktree ? (
                <>
                  <Spinner className="size-4" />
                  {worktreeT("removing")}
                </>
              ) : (
                worktreeT("removeWorktree")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
