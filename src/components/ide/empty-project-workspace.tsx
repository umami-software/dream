import {
  ArrowRight,
  Folder,
  FolderOpen,
  FolderTree,
  History,
  Plug,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import dreamSvg from "@/assets/dream.svg";
import { ProviderIcon } from "@/components/ai-elements/provider-icons";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SearchInput } from "@/components/ui/search-input";
import { getDesktopApi } from "@/lib/electron";
import { getConnectedProviders } from "@/lib/ide-defaults";
import { ProjectTabIcon } from "./header/project-tab-icon";
import { useIdeStore } from "./ide-store";
import { ALL_PROVIDERS, getProviderLabel } from "./ide-types";

const RECENT_PROJECT_LIMIT = 20;
const RECENT_PROJECT_VISIBLE_COUNT = 6;
const RECENT_PROJECT_ROW_HEIGHT_PX = 48;
const RECENT_PROJECT_ROW_GAP_PX = 4;

const formatLastUsedAt = (
  value: string | null | undefined,
  labels: {
    daysAgo: (count: number) => string;
    hoursAgo: (count: number) => string;
    justNow: string;
    minutesAgo: (count: number) => string;
    yesterday: string;
  },
): string | null => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }

  const diffMs = Date.now() - time;
  const pastMs = Math.max(0, diffMs);
  const minutes = Math.floor(pastMs / 60_000);
  if (minutes < 1) {
    return labels.justNow;
  }
  if (minutes < 60) {
    return labels.minutesAgo(minutes);
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return labels.hoursAgo(hours);
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return labels.yesterday;
  }
  if (days < 7) {
    return labels.daysAgo(days);
  }

  const now = new Date();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

const getLatestTimestamp = (left: string | null, right: string | null) => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return Date.parse(right) > Date.parse(left) ? right : left;
};

const getTimestampMs = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

export const EmptyProjectWorkspace = () => {
  const emptyT = useTranslations("emptyProject");
  const panelsT = useTranslations("panels");
  const timeT = useTranslations("time");
  const closedProjects = useIdeStore((s) => s.closedProjects);
  const chats = useIdeStore((s) => s.chats);
  const settings = useIdeStore((s) => s.settings);
  const addProject = useIdeStore((s) => s.addProject);
  const setSettingsOpen = useIdeStore((s) => s.setSettingsOpen);
  const setSettingsSection = useIdeStore((s) => s.setSettingsSection);
  const [recentProjectQuery, setRecentProjectQuery] = useState("");

  const connectedProviders = useMemo(
    () => getConnectedProviders(settings),
    [settings],
  );
  const hasConnectedProvider = connectedProviders.length > 0;

  const chatLastUsedAtByProject = useMemo(() => {
    const timestamps = new Map<string, string>();

    for (const chat of chats) {
      const timestamp = chat.updatedAt || chat.createdAt;
      if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
        continue;
      }

      timestamps.set(
        chat.projectId,
        getLatestTimestamp(timestamps.get(chat.projectId) ?? null, timestamp) ??
          timestamp,
      );
    }

    return timestamps;
  }, [chats]);
  const recentProjects = useMemo(
    () =>
      closedProjects
        .map((project, index) => ({
          index,
          lastUsedAt:
            project.lastUsedAt ??
            chatLastUsedAtByProject.get(project.id) ??
            null,
          project,
        }))
        .sort(
          (left, right) =>
            getTimestampMs(right.lastUsedAt) -
              getTimestampMs(left.lastUsedAt) || right.index - left.index,
        )
        .slice(0, RECENT_PROJECT_LIMIT)
        .map(({ project }) => project),
    [chatLastUsedAtByProject, closedProjects],
  );
  const filteredRecentProjects = useMemo(() => {
    const query = recentProjectQuery.trim().toLocaleLowerCase();
    if (!query) {
      return recentProjects;
    }

    return recentProjects.filter(
      (project) =>
        project.name.toLocaleLowerCase().includes(query) ||
        project.path.toLocaleLowerCase().includes(query),
    );
  }, [recentProjectQuery, recentProjects]);

  const handleOpenFolder = useCallback(async () => {
    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      window.alert(emptyT("electronRequired"));
      return;
    }

    const selectedPath = await desktopApi.pickProjectDirectory();
    if (!selectedPath) {
      return;
    }

    addProject(selectedPath);
  }, [addProject, emptyT]);

  const handleOpenProviders = useCallback(() => {
    setSettingsSection("providers");
    setSettingsOpen(true);
  }, [setSettingsOpen, setSettingsSection]);

  if (!hasConnectedProvider) {
    return (
      <Empty className="h-full gap-6 rounded-none border-0 p-6">
        <EmptyHeader className="max-w-xl gap-4">
          <img alt="" className="size-16" draggable={false} src={dreamSvg} />
          <EmptyMedia className="mb-0 size-10 rounded-full" variant="icon">
            <Plug className="size-5" />
          </EmptyMedia>
          <EmptyTitle>{emptyT("connectProvider")}</EmptyTitle>
          <EmptyDescription className="max-w-md">
            {emptyT("connectProviderDescription")}
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="max-w-xl gap-6">
          <Button onClick={handleOpenProviders} size="lg">
            <Settings className="size-4" />
            {emptyT("openProviders")}
          </Button>

          <div className="grid w-full gap-1">
            {ALL_PROVIDERS.map((provider) => (
              <button
                className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-sm border border-transparent px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-surface-300 dark:hover:bg-[color-mix(in_oklab,var(--muted)_70%,var(--background))] dark:focus-visible:border-surface-700 focus-visible:outline-none"
                key={provider}
                onClick={handleOpenProviders}
                type="button"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <ProviderIcon provider={provider} className="size-4" />
                </span>
                <span className="block min-w-0 flex-1 truncate font-medium text-foreground text-sm">
                  {getProviderLabel(provider)}
                </span>
                <ArrowRight className="size-4 shrink-0" />
              </button>
            ))}
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty className="h-full gap-6 rounded-none border-0 p-6">
      <EmptyHeader className="max-w-xl gap-4">
        <img alt="" className="size-16" draggable={false} src={dreamSvg} />
        <EmptyTitle>{emptyT("getStarted")}</EmptyTitle>
      </EmptyHeader>

      <EmptyContent className="max-w-xl gap-10">
        <Button onClick={() => void handleOpenFolder()} size="lg">
          <FolderOpen className="size-4" />
          {emptyT("openFolder")}
        </Button>

        {recentProjects.length > 0 ? (
          <div className="flex w-full flex-col items-stretch gap-2">
            <div className="flex items-center justify-between gap-4 px-1">
              <div className="flex shrink-0 items-center gap-2 font-medium text-muted-foreground text-sm">
                <History className="size-3.5" />
                {emptyT("recentlyClosed")}
              </div>
              <SearchInput
                aria-label={emptyT("searchRecentlyClosed")}
                autoComplete="off"
                className="w-full min-w-0 max-w-64"
                clearLabel={panelsT("clearSearch")}
                onValueChange={setRecentProjectQuery}
                placeholder={emptyT("searchRecentlyClosed")}
                value={recentProjectQuery}
              />
            </div>
            {filteredRecentProjects.length > 0 ? (
              <div
                className="grid w-full gap-1 overflow-y-auto pr-1"
                style={{
                  maxHeight:
                    RECENT_PROJECT_VISIBLE_COUNT *
                      RECENT_PROJECT_ROW_HEIGHT_PX +
                    (RECENT_PROJECT_VISIBLE_COUNT - 1) *
                      RECENT_PROJECT_ROW_GAP_PX,
                }}
              >
                {filteredRecentProjects.map((project) => {
                  const isWorktree = project.worktree?.kind === "worktree";
                  const lastUsedAt =
                    project.lastUsedAt ??
                    chatLastUsedAtByProject.get(project.id) ??
                    null;
                  const lastUsedLabel = formatLastUsedAt(lastUsedAt, {
                    daysAgo: (count) => timeT("daysAgo", { count }),
                    hoursAgo: (count) => timeT("hoursAgo", { count }),
                    justNow: timeT("justNow"),
                    minutesAgo: (count) => timeT("minutesAgo", { count }),
                    yesterday: timeT("yesterday"),
                  });

                  return (
                    <button
                      className="group flex min-h-12 w-full min-w-0 items-center gap-3 rounded-sm border border-transparent px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-surface-300 dark:hover:bg-[color-mix(in_oklab,var(--muted)_70%,var(--background))] dark:focus-visible:border-surface-700 focus-visible:outline-none"
                      key={project.id}
                      onClick={() => addProject(project.path)}
                      type="button"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {isWorktree ? (
                          <FolderTree className="size-4" />
                        ) : project.icon ? (
                          <ProjectTabIcon
                            fallback={<Folder className="size-4" />}
                            icon={project.icon}
                            projectName={project.name}
                            projectPath={project.path}
                          />
                        ) : (
                          <Folder className="size-4" />
                        )}
                      </span>
                      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                        <span className="col-start-1 block truncate font-medium text-foreground text-sm">
                          {project.name}
                        </span>
                        {lastUsedLabel ? (
                          <span
                            className="col-start-2 row-span-2 self-center whitespace-nowrap text-right text-muted-foreground/80 text-xs"
                            title={
                              lastUsedAt
                                ? new Date(lastUsedAt).toLocaleString()
                                : undefined
                            }
                          >
                            {lastUsedLabel}
                          </span>
                        ) : null}
                        <span className="col-start-1 block truncate text-muted-foreground text-xs">
                          {isWorktree ? emptyT("worktree") : project.path}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                {emptyT("noMatchingProjects")}
              </p>
            )}
          </div>
        ) : null}
      </EmptyContent>
    </Empty>
  );
};
