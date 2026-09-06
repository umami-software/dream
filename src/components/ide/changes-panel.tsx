import {
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  Columns2,
  Ellipsis,
  RotateCw,
  Rows3,
  TextWrap,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useProjectGitStatus } from "@/hooks/use-project-git-status";
import { cn } from "@/lib/utils";
import type {
  ProjectGitDiffResponse,
  ProjectGitStatusEntry,
} from "@/types/ide";
import { ChangesRow, type DiffViewMode, readResponseText } from "./changes";
import { toggleExpandedPathForProject } from "./changes/expansion-state";
import { AppShellPlaceholder } from "./ide-helpers";
import { useIdeStore } from "./ide-store";
import { RightPanelHeaderIconButton } from "./right-panel-header-icon-button";

type DiffLoadRequest = {
  filePath: string;
  refreshKey: number;
};

export interface ChangesPanelProps {
  active?: boolean;
  onClosePanel: () => void;
  projectId?: string | null;
}

const getExpandedPaths = (
  expandedPathsByProject: Record<string, string[]>,
  projectId: string | null,
) => {
  if (!projectId) {
    return [];
  }

  return expandedPathsByProject[projectId] ?? [];
};

const ChangesPanelImpl = ({
  active = true,
  onClosePanel,
  projectId: requestedProjectId,
}: ChangesPanelProps) => {
  const commonT = useTranslations("common");
  const panelsT = useTranslations("panels");
  const uiT = useTranslations("ui");
  const activeProject = useIdeStore((s) =>
    requestedProjectId
      ? (s.projects.find((project) => project.id === requestedProjectId) ??
        null)
      : s.getActiveProject(),
  );
  const diffLoadInFlightPathsRef = useRef(new Map<string, number>());
  const diffLoadQueueRef = useRef<DiffLoadRequest[]>([]);
  const diffLoadQueuedPathsRef = useRef(new Map<string, number>());
  const diffLoadProcessingRef = useRef(false);
  const projectDiffErrorsRef = useRef<Record<string, string>>({});
  const projectDiffLoadingRef = useRef<Record<string, boolean>>({});
  const projectDiffRefreshKeysRef = useRef<Record<string, number>>({});
  const projectDiffsRef = useRef<Record<string, ProjectGitDiffResponse>>({});
  const queuedProjectIdRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  const activeProjectIdRef = useRef<string | null>(null);
  const latestGitRefreshKeyRef = useRef(0);
  const changesByPathRef = useRef(new Map<string, ProjectGitStatusEntry>());

  const [expandedPathsByProject, setExpandedPathsByProject] = useState<
    Record<string, string[]>
  >({});
  const [diffsByProject, setDiffsByProject] = useState<
    Record<string, Record<string, ProjectGitDiffResponse>>
  >({});
  const [diffViewModeByProject, setDiffViewModeByProject] = useState<
    Record<string, DiffViewMode>
  >({});
  const [diffErrorsByProject, setDiffErrorsByProject] = useState<
    Record<string, Record<string, string>>
  >({});
  const [diffLoadingByProject, setDiffLoadingByProject] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [diffRefreshKeysByProject, setDiffRefreshKeysByProject] = useState<
    Record<string, Record<string, number>>
  >({});
  const [forcedRenderedDiffsByProject, setForcedRenderedDiffsByProject] =
    useState<Record<string, string[]>>({});
  const [revertingPathsByProject, setRevertingPathsByProject] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [hiddenRevertedPathsByProject, setHiddenRevertedPathsByProject] =
    useState<Record<string, string[]>>({});

  const projectId = activeProject?.id ?? null;
  const projectPath = activeProject?.path ?? null;
  const wordWrapEnabled = activeProject?.ui.changesDiffWordWrap ?? false;
  const gitRefreshKey = useIdeStore((s) =>
    projectId ? (s.projectGitRefreshKeys[projectId] ?? 0) : 0,
  );
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const {
    changes,
    error: statusError,
    isRepo,
    loading: statusLoading,
    status: gitStatus,
    statusRefreshToken,
  } = useProjectGitStatus(projectPath, gitRefreshKey, {
    detail: active ? "full" : "summary",
  });
  const hasStaleGitStatus = statusLoading && gitStatus !== null;
  const hasFreshGitStatus = statusRefreshToken === gitRefreshKey;

  const expandedPaths = getExpandedPaths(expandedPathsByProject, projectId);
  const changesByPath = useMemo(
    () => new Map(changes.map((change) => [change.path, change])),
    [changes],
  );
  const diffViewMode = projectId
    ? (diffViewModeByProject[projectId] ?? "unified")
    : "unified";
  const projectDiffs = projectId ? (diffsByProject[projectId] ?? {}) : {};
  const projectDiffErrors = projectId
    ? (diffErrorsByProject[projectId] ?? {})
    : {};
  const projectDiffLoading = projectId
    ? (diffLoadingByProject[projectId] ?? {})
    : {};
  const projectDiffRefreshKeys = projectId
    ? (diffRefreshKeysByProject[projectId] ?? {})
    : {};
  const forcedRenderedDiffs = projectId
    ? (forcedRenderedDiffsByProject[projectId] ?? [])
    : [];
  const revertingPaths = projectId
    ? (revertingPathsByProject[projectId] ?? {})
    : {};
  const hiddenRevertedPaths = projectId
    ? (hiddenRevertedPathsByProject[projectId] ?? [])
    : [];
  const hiddenRevertedPathSet = useMemo(
    () => new Set(hiddenRevertedPaths),
    [hiddenRevertedPaths],
  );
  const visibleChanges = useMemo(
    () => changes.filter((change) => !hiddenRevertedPathSet.has(change.path)),
    [changes, hiddenRevertedPathSet],
  );
  const visibleChangePaths = useMemo(
    () => visibleChanges.map((change) => change.path),
    [visibleChanges],
  );
  const expandedPathSet = useMemo(
    () => new Set(expandedPaths),
    [expandedPaths],
  );
  const forcedRenderedDiffPathSet = useMemo(
    () => new Set(forcedRenderedDiffs),
    [forcedRenderedDiffs],
  );
  const allExpanded =
    visibleChangePaths.length > 0 &&
    visibleChangePaths.every((filePath) => expandedPathSet.has(filePath));
  const expandAllTitle = allExpanded
    ? panelsT("collapseAll")
    : panelsT("expandAll");
  const shouldDeferDiffLoads = useCallback(() => {
    if (!projectId) {
      return true;
    }

    return statusLoading || !hasFreshGitStatus;
  }, [hasFreshGitStatus, projectId, statusLoading]);

  useEffect(() => {
    queuedProjectIdRef.current = projectId;
    diffLoadQueueRef.current = [];
    diffLoadQueuedPathsRef.current.clear();
    diffLoadInFlightPathsRef.current.clear();
    diffLoadProcessingRef.current = false;
  }, [projectId]);

  useEffect(() => {
    projectDiffsRef.current = projectDiffs;
    projectDiffErrorsRef.current = projectDiffErrors;
    projectDiffLoadingRef.current = projectDiffLoading;
    projectDiffRefreshKeysRef.current = projectDiffRefreshKeys;
  }, [
    projectDiffErrors,
    projectDiffLoading,
    projectDiffRefreshKeys,
    projectDiffs,
  ]);

  useEffect(() => {
    latestGitRefreshKeyRef.current = gitRefreshKey;
  }, [gitRefreshKey]);

  useEffect(() => {
    changesByPathRef.current = changesByPath;
  }, [changesByPath]);

  useEffect(() => {
    if (!projectId || hiddenRevertedPaths.length === 0) {
      return;
    }

    const remainingHiddenPaths = hiddenRevertedPaths.filter((path) =>
      changesByPath.has(path),
    );
    if (remainingHiddenPaths.length === hiddenRevertedPaths.length) {
      return;
    }

    setHiddenRevertedPathsByProject((current) => ({
      ...current,
      [projectId]: remainingHiddenPaths,
    }));
  }, [changesByPath, hiddenRevertedPaths, projectId]);

  useEffect(() => {
    const shouldRefresh =
      active &&
      !!projectId &&
      (!wasActiveRef.current || activeProjectIdRef.current !== projectId);
    wasActiveRef.current = active;
    activeProjectIdRef.current = projectId;

    if (shouldRefresh) {
      bumpProjectGitRefreshKey(projectId);
    }
  }, [active, bumpProjectGitRefreshKey, projectId]);

  const processQueuedDiffLoads = useCallback(async () => {
    if (
      diffLoadProcessingRef.current ||
      !projectId ||
      !projectPath ||
      diffLoadQueueRef.current.length === 0
    ) {
      return;
    }

    const nextRequest = diffLoadQueueRef.current.shift();
    if (!nextRequest) {
      return;
    }
    const { filePath: nextFilePath, refreshKey: requestRefreshKey } =
      nextRequest;

    diffLoadProcessingRef.current = true;
    if (
      diffLoadQueuedPathsRef.current.get(nextFilePath) === requestRefreshKey
    ) {
      diffLoadQueuedPathsRef.current.delete(nextFilePath);
    }
    diffLoadInFlightPathsRef.current.set(nextFilePath, requestRefreshKey);

    try {
      const change = changesByPathRef.current.get(nextFilePath);
      if (!change) {
        throw new Error(panelsT("noDiffOutput"));
      }

      const response = await fetch("/api/project-git-diff", {
        body: JSON.stringify({
          filePath: nextFilePath,
          previousPath: change.previousPath,
          projectPath,
          status: change.status,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          await readResponseText(
            response,
            uiT("requestFailedStatus", { status: response.status }),
          ),
        );
      }

      const payload = (await response.json()) as ProjectGitDiffResponse;
      if (queuedProjectIdRef.current !== projectId) {
        return;
      }
      const currentPayloadRefreshKey =
        projectDiffRefreshKeysRef.current[nextFilePath] ?? -1;
      if (
        requestRefreshKey < latestGitRefreshKeyRef.current ||
        requestRefreshKey < currentPayloadRefreshKey
      ) {
        return;
      }

      setDiffsByProject((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [nextFilePath]: payload,
          [payload.filePath]: payload,
        },
      }));
      setDiffRefreshKeysByProject((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [nextFilePath]: requestRefreshKey,
          [payload.filePath]: requestRefreshKey,
        },
      }));
      setDiffErrorsByProject((current) => {
        const nextProjectErrors = { ...(current[projectId] ?? {}) };
        delete nextProjectErrors[nextFilePath];

        return {
          ...current,
          [projectId]: nextProjectErrors,
        };
      });
    } catch (error) {
      if (queuedProjectIdRef.current !== projectId) {
        return;
      }
      if (requestRefreshKey < latestGitRefreshKeyRef.current) {
        return;
      }

      setDiffErrorsByProject((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [nextFilePath]:
            error instanceof Error
              ? error.message
              : panelsT("failedToLoadDiff"),
        },
      }));
    } finally {
      if (
        diffLoadInFlightPathsRef.current.get(nextFilePath) === requestRefreshKey
      ) {
        diffLoadInFlightPathsRef.current.delete(nextFilePath);
      }

      if (queuedProjectIdRef.current === projectId) {
        const stillLoading =
          diffLoadQueuedPathsRef.current.has(nextFilePath) ||
          diffLoadInFlightPathsRef.current.has(nextFilePath);
        projectDiffLoadingRef.current = {
          ...projectDiffLoadingRef.current,
          [nextFilePath]: stillLoading,
        };
        setDiffLoadingByProject((current) => ({
          ...current,
          [projectId]: {
            ...(current[projectId] ?? {}),
            [nextFilePath]: stillLoading,
          },
        }));
      }

      diffLoadProcessingRef.current = false;

      if (
        queuedProjectIdRef.current === projectId &&
        diffLoadQueueRef.current.length > 0
      ) {
        void processQueuedDiffLoads();
      }
    }
  }, [panelsT, projectId, projectPath, uiT]);

  const queueDiffLoad = useCallback(
    (filePath: string, priority = false, force = false) => {
      if (!projectId || !projectPath) {
        return;
      }

      const loadedRefreshKey = projectDiffRefreshKeysRef.current[filePath];
      const queuedRefreshKey = diffLoadQueuedPathsRef.current.get(filePath);
      const inFlightRefreshKey = diffLoadInFlightPathsRef.current.get(filePath);

      if (
        (!force &&
          loadedRefreshKey === gitRefreshKey &&
          (projectDiffsRef.current[filePath] ||
            projectDiffErrorsRef.current[filePath])) ||
        (typeof queuedRefreshKey === "number" &&
          queuedRefreshKey >= gitRefreshKey) ||
        (typeof inFlightRefreshKey === "number" &&
          inFlightRefreshKey >= gitRefreshKey)
      ) {
        return;
      }

      diffLoadQueueRef.current = diffLoadQueueRef.current.filter(
        (request) => request.filePath !== filePath,
      );
      diffLoadQueuedPathsRef.current.set(filePath, gitRefreshKey);
      projectDiffLoadingRef.current = {
        ...projectDiffLoadingRef.current,
        [filePath]: true,
      };
      const request = { filePath, refreshKey: gitRefreshKey };
      if (priority) {
        diffLoadQueueRef.current.unshift(request);
      } else {
        diffLoadQueueRef.current.push(request);
      }

      setDiffLoadingByProject((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [filePath]: true,
        },
      }));

      void processQueuedDiffLoads();
    },
    [gitRefreshKey, processQueuedDiffLoads, projectId, projectPath],
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }

    if (statusLoading || shouldDeferDiffLoads()) {
      return;
    }

    for (const filePath of expandedPaths) {
      if (changesByPath.has(filePath)) {
        queueDiffLoad(
          filePath,
          false,
          projectDiffRefreshKeys[filePath] !== gitRefreshKey,
        );
      }
    }
  }, [
    changesByPath,
    expandedPaths,
    gitRefreshKey,
    projectId,
    projectDiffRefreshKeys,
    queueDiffLoad,
    shouldDeferDiffLoads,
    statusLoading,
  ]);

  useEffect(() => {
    if (!projectId || statusLoading || shouldDeferDiffLoads()) {
      return;
    }

    setExpandedPathsByProject((current) => {
      const currentPaths = current[projectId] ?? [];
      const nextPaths = currentPaths.filter((path) => changesByPath.has(path));
      if (nextPaths.length === currentPaths.length) {
        return current;
      }

      return {
        ...current,
        [projectId]: nextPaths,
      };
    });
  }, [changesByPath, projectId, shouldDeferDiffLoads, statusLoading]);

  const handleTogglePath = useCallback(
    (filePath: string) => {
      if (!projectId) {
        return;
      }

      setExpandedPathsByProject((current) =>
        toggleExpandedPathForProject(current, projectId, filePath),
      );
    },
    [projectId],
  );

  const handleToggleExpandAll = useCallback(() => {
    if (!projectId) {
      return;
    }

    if (allExpanded) {
      setExpandedPathsByProject((current) => ({
        ...current,
        [projectId]: [],
      }));
      return;
    }

    const nextPaths = visibleChangePaths;
    setExpandedPathsByProject((current) => ({
      ...current,
      [projectId]: nextPaths,
    }));
  }, [allExpanded, projectId, visibleChangePaths]);

  const handleSetDiffViewMode = useCallback(
    (nextMode: DiffViewMode) => {
      if (!projectId) {
        return;
      }

      setDiffViewModeByProject((current) => ({
        ...current,
        [projectId]: nextMode,
      }));
    },
    [projectId],
  );

  const handleRefreshChanges = useCallback(() => {
    if (!projectId) {
      return;
    }
    bumpProjectGitRefreshKey(projectId);
  }, [bumpProjectGitRefreshKey, projectId]);

  const handleWordWrapChange = useCallback(
    (enabled: boolean) => {
      if (!projectId) {
        return;
      }

      useIdeStore.getState().updateProject(projectId, (project) => ({
        ...project,
        ui: {
          ...project.ui,
          changesDiffWordWrap: enabled,
        },
      }));
    },
    [projectId],
  );

  const clearCachedDiffForPath = useCallback(
    (filePath: string) => {
      if (!projectId) {
        return;
      }

      diffLoadQueueRef.current = diffLoadQueueRef.current.filter(
        (request) => request.filePath !== filePath,
      );
      diffLoadQueuedPathsRef.current.delete(filePath);
      diffLoadInFlightPathsRef.current.delete(filePath);

      setDiffsByProject((current) => {
        const nextProjectDiffs = { ...(current[projectId] ?? {}) };
        delete nextProjectDiffs[filePath];
        return { ...current, [projectId]: nextProjectDiffs };
      });
      setDiffErrorsByProject((current) => {
        const nextProjectErrors = { ...(current[projectId] ?? {}) };
        delete nextProjectErrors[filePath];
        return { ...current, [projectId]: nextProjectErrors };
      });
      setDiffLoadingByProject((current) => {
        const nextProjectLoading = { ...(current[projectId] ?? {}) };
        delete nextProjectLoading[filePath];
        return { ...current, [projectId]: nextProjectLoading };
      });
      setDiffRefreshKeysByProject((current) => {
        const nextProjectRefreshKeys = { ...(current[projectId] ?? {}) };
        delete nextProjectRefreshKeys[filePath];
        return { ...current, [projectId]: nextProjectRefreshKeys };
      });
      setForcedRenderedDiffsByProject((current) => ({
        ...current,
        [projectId]: (current[projectId] ?? []).filter(
          (path) => path !== filePath,
        ),
      }));
      setExpandedPathsByProject((current) => ({
        ...current,
        [projectId]: (current[projectId] ?? []).filter(
          (path) => path !== filePath,
        ),
      }));
    },
    [projectId],
  );

  const handleRevertFile = useCallback(
    async (change: ProjectGitStatusEntry) => {
      if (
        !projectId ||
        !projectPath ||
        revertingPaths[change.path] ||
        hiddenRevertedPathSet.has(change.path)
      ) {
        return;
      }

      clearCachedDiffForPath(change.path);
      setHiddenRevertedPathsByProject((current) => ({
        ...current,
        [projectId]: [...new Set([...(current[projectId] ?? []), change.path])],
      }));
      setRevertingPathsByProject((current) => ({
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [change.path]: true,
        },
      }));

      try {
        const response = await fetch("/api/project-git-revert-file", {
          body: JSON.stringify({
            filePath: change.path,
            previousPath: change.previousPath,
            projectPath,
            status: change.status,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(
            await readResponseText(
              response,
              uiT("requestFailedStatus", { status: response.status }),
            ),
          );
        }

        bumpProjectGitRefreshKey(projectId);
      } catch (error) {
        console.error("[changes] Failed to revert file", error);
        bumpProjectGitRefreshKey(projectId);
      } finally {
        setRevertingPathsByProject((current) => {
          const nextProjectReverting = { ...(current[projectId] ?? {}) };
          delete nextProjectReverting[change.path];
          return { ...current, [projectId]: nextProjectReverting };
        });
      }
    },
    [
      bumpProjectGitRefreshKey,
      clearCachedDiffForPath,
      hiddenRevertedPathSet,
      projectId,
      projectPath,
      revertingPaths,
      uiT,
    ],
  );

  const handleRevertAllChanges = useCallback(async () => {
    for (const change of visibleChanges) {
      await handleRevertFile(change);
    }
  }, [handleRevertFile, visibleChanges]);

  const handleForceRenderDiff = useCallback(
    (filePath: string) => {
      if (!projectId) {
        return;
      }

      setForcedRenderedDiffsByProject((current) => {
        const currentPaths = current[projectId] ?? [];
        if (currentPaths.includes(filePath)) {
          return current;
        }

        return {
          ...current,
          [projectId]: [...currentPaths, filePath],
        };
      });
    },
    [projectId],
  );

  if (!activeProject) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm font-medium">
          <RightPanelHeaderIconButton icon={Code} onClose={onClosePanel} />
          <span>{commonT("changes")}</span>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <AppShellPlaceholder message={panelsT("addProjectForChanges")} />
        </div>
      </div>
    );
  }

  return (
    <div className="changes-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-3 py-2">
        <RightPanelHeaderIconButton icon={Code} onClose={onClosePanel} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {commonT("changes")}
          </div>
        </div>

        <div className="flex overflow-hidden rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 p-0.5">
          <button
            aria-label={panelsT("unifiedDiff")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
              diffViewMode === "unified"
                ? "bg-muted text-foreground shadow-sm"
                : "hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-foreground",
            )}
            onClick={() => handleSetDiffViewMode("unified")}
            title={panelsT("unifiedDiff")}
            type="button"
          >
            <Rows3 className="size-3.5" />
          </button>
          <button
            aria-label={panelsT("splitDiff")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
              diffViewMode === "split"
                ? "bg-muted text-foreground shadow-sm"
                : "hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-foreground",
            )}
            onClick={() => handleSetDiffViewMode("split")}
            title={panelsT("splitDiff")}
            type="button"
          >
            <Columns2 className="size-3.5" />
          </button>
        </div>

        <Button
          aria-label={expandAllTitle}
          className="size-7 p-0"
          disabled={visibleChanges.length === 0}
          onClick={handleToggleExpandAll}
          title={expandAllTitle}
          type="button"
          variant="outline"
        >
          {allExpanded ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label={panelsT("changesActions")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
                title={panelsT("changesActions")}
                type="button"
              />
            }
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={handleRefreshChanges}>
              <RotateCw className="size-4" />
              {commonT("refresh")}
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={wordWrapEnabled}
              onCheckedChange={handleWordWrapChange}
            >
              <TextWrap className="size-4" />
              {panelsT("enableWordWrap")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={
                visibleChanges.length === 0 ||
                Object.keys(revertingPaths).length > 0
              }
              onClick={handleRevertAllChanges}
              variant="destructive"
            >
              <Undo2 className="size-4" />
              {panelsT("revertAllChanges")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {statusError ? (
          <div className="rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-destructive text-sm">
            {statusError}
          </div>
        ) : null}

        {!statusError && (!statusLoading || hasStaleGitStatus) && !isRepo ? (
          <AppShellPlaceholder message={panelsT("notGitRepository")} />
        ) : null}

        {!statusError &&
        statusLoading &&
        !hasStaleGitStatus &&
        visibleChanges.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
            </div>
          </div>
        ) : null}

        {!statusError &&
        (!statusLoading || hasStaleGitStatus) &&
        isRepo &&
        visibleChanges.length === 0 ? (
          <AppShellPlaceholder message={panelsT("workingTreeClean")} />
        ) : null}

        {!statusError && visibleChanges.length > 0 ? (
          <div className="-mx-3 -mb-3">
            {visibleChanges.map((change) => (
              <ChangesRow
                change={change}
                diff={projectDiffs[change.path] ?? null}
                diffError={projectDiffErrors[change.path] ?? null}
                diffLoading={projectDiffLoading[change.path] ?? false}
                expanded={expandedPathSet.has(change.path)}
                forceRenderDiff={forcedRenderedDiffPathSet.has(change.path)}
                key={`${activeProject.id}:${change.path}`}
                mode={diffViewMode}
                onForceRenderDiff={() => handleForceRenderDiff(change.path)}
                onRevert={() => handleRevertFile(change)}
                onToggle={() => handleTogglePath(change.path)}
                projectId={activeProject.id}
                projectPath={activeProject.path}
                reverting={revertingPaths[change.path] ?? false}
                wordWrap={wordWrapEnabled}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const ChangesPanel = memo(ChangesPanelImpl);
ChangesPanel.displayName = "ChangesPanel";
