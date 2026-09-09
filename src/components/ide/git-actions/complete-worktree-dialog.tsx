import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  FolderX,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Home,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getDefaultGitGenerationModelSelection } from "@/lib/ide-defaults";
import { cn } from "@/lib/utils";
import type {
  ProjectConfig,
  ProjectGitDiffResponse,
  ProjectGitStatusEntry,
  ProjectGitWorktreeCleanupResponse,
  ProjectGitWorktreeCompareResponse,
  ProjectGitWorktreeMergeResponse,
  ProjectWorktreeInfo,
  WorktreeCompletionAction,
} from "@/types/ide";
import {
  DIFF_RENDER_CHANGED_LINE_LIMIT,
  IdeDiffViewer,
  LargeDiffGuard,
} from "../diff-viewer";
import { normalizeProjectPathKey } from "../ide-state";
import { useIdeStore } from "../ide-store";
import { MaterialFileIcon } from "../material-file-icon";
import { isMissingWorktreeError } from "../store/project-lifecycle-actions";
import { CommitDialog } from "./commit-dialog";
import { CreatePrDialog } from "./create-pr-dialog";
import {
  ActionError,
  DialogMetricRow,
  GitDialogHeader,
  NextStepSelector,
} from "./dialog-layout";
import { GitChangesDeltaSummary } from "./summary";
import { postJson } from "./utils";

type WorktreeProject = ProjectConfig & { worktree: ProjectWorktreeInfo };
type Phase = "review" | "commit" | "pr" | "working" | "done";
type DiffState = {
  diff: ProjectGitDiffResponse | null;
  error: string | null;
  loading: boolean;
};

const MAX_DIRTY_FILES_SHOWN = 8;

const CompareFileRow = ({
  baseRef,
  change,
  projectPath,
}: {
  baseRef: string | null;
  change: ProjectGitStatusEntry;
  projectPath: string;
}) => {
  const worktreeT = useTranslations("worktrees");
  const [expanded, setExpanded] = useState(false);
  const [forceRender, setForceRender] = useState(false);
  const [diffState, setDiffState] = useState<DiffState>({
    diff: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!expanded || diffState.diff || diffState.loading || diffState.error) {
      return;
    }

    let cancelled = false;
    setDiffState({ diff: null, error: null, loading: true });
    void (async () => {
      try {
        const diff = await postJson<ProjectGitDiffResponse>(
          "/api/project-git-worktree-compare-diff",
          {
            baseRef,
            filePath: change.path,
            previousPath: change.previousPath,
            projectPath,
            status: change.status,
          },
          worktreeT("unableToLoadDiff"),
        );
        if (!cancelled) {
          setDiffState({ diff, error: null, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setDiffState({
            diff: null,
            error:
              error instanceof Error
                ? error.message
                : worktreeT("unableToLoadDiff"),
            loading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseRef, change, diffState, expanded, projectPath, worktreeT]);

  const changedLineCount = change.addedLines + change.removedLines;
  const diffTooLarge =
    changedLineCount > DIFF_RENDER_CHANGED_LINE_LIMIT && !forceRender;

  return (
    <div className="border-surface-200 border-b last:border-b-0 dark:border-surface-800">
      <button
        aria-expanded={expanded}
        className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <MaterialFileIcon className="size-4 shrink-0" path={change.path} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {change.path}
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
          <span className="font-medium text-emerald-600">
            +{change.addedLines}
          </span>
          <span className="font-medium text-rose-600">
            -{change.removedLines}
          </span>
        </span>
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </button>
      {expanded ? (
        <div className="border-surface-200 border-t bg-background text-xs dark:border-surface-800">
          {diffState.loading || (!diffState.diff && !diffState.error) ? (
            <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground">
              <Spinner className="size-4" />
            </div>
          ) : diffState.error ? (
            <div className="px-4 py-3">
              <ActionError error={diffState.error} />
            </div>
          ) : diffState.diff ? (
            <div className="overflow-x-hidden">
              {change.previousPath ? (
                <div className="border-surface-200 border-b px-4 py-2 text-muted-foreground dark:border-surface-800">
                  {`${change.previousPath} -> ${change.path}`}
                </div>
              ) : null}
              {diffTooLarge ? (
                <LargeDiffGuard
                  changedLineCount={changedLineCount}
                  onRenderAnyway={() => setForceRender(true)}
                />
              ) : diffState.diff.parsedDiff ? (
                <IdeDiffViewer
                  changedLineCount={changedLineCount}
                  className="min-w-0"
                  diffStyle="unified"
                  fileDiff={diffState.diff.parsedDiff}
                  largeDiffGuardEnabled={false}
                  wordWrap
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words p-4 font-mono">
                  {diffState.diff.diff}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const InfoLine = ({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warning";
}) => (
  <div
    className={cn(
      "flex items-start gap-2 text-xs",
      tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground",
    )}
  >
    {tone === "warning" ? (
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
    ) : null}
    <span>{children}</span>
  </div>
);

export const CompleteWorktreeDialog = ({
  onOpenChange,
  open,
  project,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: WorktreeProject;
}) => {
  const commonT = useTranslations("common");
  const gitT = useTranslations("git");
  const worktreeT = useTranslations("worktrees");
  const format = useFormatter();
  const settings = useIdeStore((s) => s.settings);
  const { model, provider } = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[project.id] ?? 0,
  );
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const openExternalUrl = useIdeStore((s) => s.openExternalUrl);
  const purgeWorktreeProject = useIdeStore((s) => s.purgeWorktreeProject);
  const stopProjectTerminals = useIdeStore((s) => s.stopProjectTerminals);
  const mainWorktreePathKey = normalizeProjectPathKey(
    project.worktree.mainWorktreePath,
  );
  const parentProjectId = useIdeStore(
    (s) =>
      s.projects.find((item) => item.id === project.worktree.parentProjectId)
        ?.id ??
      s.projects.find(
        (item) => normalizeProjectPathKey(item.path) === mainWorktreePathKey,
      )?.id ??
      null,
  );

  const [phase, setPhase] = useState<Phase>("review");
  const [compare, setCompare] =
    useState<ProjectGitWorktreeCompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [action, setAction] = useState<WorktreeCompletionAction>("remove");
  const [actionTouched, setActionTouched] = useState(false);
  const [discardUncommitted, setDiscardUncommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictingFiles, setConflictingFiles] = useState<string[]>([]);
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<Extract<
    ProjectGitWorktreeMergeResponse,
    { status: "merged" }
  > | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] =
    useState<ProjectGitWorktreeCleanupResponse | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [retryingCleanup, setRetryingCleanup] = useState(false);
  const prHandoffRef = useRef(false);
  const cleanupOptionsRef = useRef<{ deleteBranch: boolean }>({
    deleteBranch: false,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setPhase("review");
    setAction("remove");
    setActionTouched(false);
    setDiscardUncommitted(false);
    setError(null);
    setConflictingFiles([]);
    setMergeResult(null);
    setPrUrl(null);
    setCleanupResult(null);
    setCleanupError(null);
    prHandoffRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "review") {
      return;
    }

    const controller = new AbortController();
    setCompareLoading(true);
    setCompareError(null);

    void (async () => {
      try {
        const response = await fetch("/api/project-git-worktree-compare", {
          body: JSON.stringify({
            baseRef: project.worktree.baseRef,
            projectPath: project.path,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text.trim() || worktreeT("unableToCompare"));
        }
        const payload =
          (await response.json()) as ProjectGitWorktreeCompareResponse;
        if (!controller.signal.aborted) {
          setCompare(payload);
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        setCompare(null);
        setCompareError(
          loadError instanceof Error
            ? loadError.message
            : worktreeT("unableToCompare"),
        );
      } finally {
        if (!controller.signal.aborted) {
          setCompareLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [open, phase, project.path, project.worktree.baseRef, worktreeT]);

  const dirtyCount = compare?.worktreeStatus.fileCount ?? 0;
  const isDirty = dirtyCount > 0;
  const mergeDisabledReason = !compare
    ? null
    : compare.aheadCount === 0
      ? worktreeT("nothingToMerge", { base: compare.baseBranch })
      : compare.mergeBase === null
        ? worktreeT("unrelatedHistories", { base: compare.baseBranch })
        : compare.mainInProgressOperation
          ? worktreeT("mainOperationInProgress")
          : !compare.mainClean
            ? worktreeT("mainWorktreeDirty", {
                branch: compare.mainBranch ?? commonT("unknown"),
                count: compare.mainDirtyCount,
              })
            : null;
  const prDisabledReason = !compare
    ? null
    : !compare.remoteName
      ? worktreeT("noRemote")
      : !compare.ghAvailable
        ? worktreeT("ghMissing")
        : compare.aheadCount === 0 && !isDirty
          ? worktreeT("nothingToMerge", { base: compare.baseBranch })
          : null;
  const mergeEnabled = Boolean(compare) && !mergeDisabledReason;
  const prEnabled = Boolean(compare) && !prDisabledReason;

  useEffect(() => {
    if (!compare || actionTouched) {
      return;
    }
    setAction(mergeEnabled ? "merge" : prEnabled ? "pr" : "remove");
  }, [actionTouched, compare, mergeEnabled, prEnabled]);

  const runCleanup = useCallback(
    async ({ deleteBranch }: { deleteBranch: boolean }) => {
      cleanupOptionsRef.current = { deleteBranch };
      setPhase("working");
      setWorkingLabel(worktreeT("removingWorktree"));
      setCleanupError(null);
      stopProjectTerminals(project.id);
      try {
        const result = await postJson<ProjectGitWorktreeCleanupResponse>(
          "/api/project-git-worktree-cleanup",
          {
            deleteBranch,
            force: discardUncommitted,
            projectPath: project.worktree.mainWorktreePath,
            worktreePath: project.path,
          },
          worktreeT("unableToRemove"),
        );
        setCleanupResult(result);
      } catch (cleanupFailure) {
        const message =
          cleanupFailure instanceof Error
            ? cleanupFailure.message
            : worktreeT("unableToRemove");
        if (isMissingWorktreeError(message)) {
          setCleanupResult({
            branch: project.worktree.branch,
            branchDeleted: false,
            branchDeleteError: null,
            path: project.path,
            pruned: true,
            removed: true,
          });
        } else {
          setCleanupError(message);
        }
      } finally {
        setPhase("done");
      }
    },
    [
      discardUncommitted,
      project.id,
      project.path,
      project.worktree.branch,
      project.worktree.mainWorktreePath,
      stopProjectTerminals,
      worktreeT,
    ],
  );

  const runMerge = useCallback(async () => {
    setPhase("working");
    setWorkingLabel(worktreeT("merging", { base: compare?.baseBranch ?? "" }));
    setError(null);
    setConflictingFiles([]);
    try {
      const result = await postJson<ProjectGitWorktreeMergeResponse>(
        "/api/project-git-worktree-merge",
        {
          acknowledgeUncommitted: discardUncommitted,
          baseRef: project.worktree.baseRef,
          projectPath: project.path,
        },
        worktreeT("unableToMerge"),
      );
      if (result.status === "conflict") {
        setError(worktreeT("mergeConflict", { base: result.baseBranch }));
        setConflictingFiles(result.conflictingFiles);
        setPhase("review");
        return;
      }

      setMergeResult(result);
      if (parentProjectId) {
        bumpProjectGitRefreshKey(parentProjectId);
      }
      await runCleanup({ deleteBranch: true });
    } catch (mergeFailure) {
      setError(
        mergeFailure instanceof Error
          ? mergeFailure.message
          : worktreeT("unableToMerge"),
      );
      setPhase("review");
    }
  }, [
    bumpProjectGitRefreshKey,
    compare?.baseBranch,
    discardUncommitted,
    parentProjectId,
    project.path,
    project.worktree.baseRef,
    runCleanup,
    worktreeT,
  ]);

  const finish = useCallback(() => {
    onOpenChange(false);
    purgeWorktreeProject(project.path, { activateProjectId: parentProjectId });
  }, [onOpenChange, parentProjectId, project.path, purgeWorktreeProject]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (phase === "working") {
        return;
      }
      if (phase === "done" && cleanupResult) {
        finish();
        return;
      }
      onOpenChange(false);
    },
    [cleanupResult, finish, onOpenChange, phase],
  );

  const handlePrimary = useCallback(() => {
    if (action === "merge") {
      void runMerge();
      return;
    }
    if (action === "pr") {
      prHandoffRef.current = false;
      setPhase("pr");
      return;
    }
    void runCleanup({ deleteBranch: false });
  }, [action, runCleanup, runMerge]);

  const handleRetryCleanup = useCallback(async () => {
    setRetryingCleanup(true);
    try {
      await runCleanup(cleanupOptionsRef.current);
    } finally {
      setRetryingCleanup(false);
    }
  }, [runCleanup]);

  const primaryDisabled =
    compareLoading ||
    (action !== "remove" && !compare) ||
    (action === "merge" && !mergeEnabled) ||
    (action === "pr" && !prEnabled) ||
    (isDirty && action !== "pr" && !discardUncommitted);
  const primaryLabel =
    action === "merge"
      ? worktreeT("mergeAndRemove")
      : action === "pr"
        ? worktreeT("continueToPr")
        : worktreeT("removeWorktree");

  if (phase === "commit") {
    return (
      <CommitDialog
        branch={project.worktree.branch}
        model={model}
        onCompleted={() => {
          bumpProjectGitRefreshKey(project.id);
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPhase("review");
          }
        }}
        open
        projectPath={project.path}
        provider={provider}
        refreshToken={gitRefreshKey}
        status={compare?.worktreeStatus ?? null}
      />
    );
  }

  if (phase === "pr") {
    return (
      <CreatePrDialog
        baseBranch={compare?.baseBranch ?? null}
        branch={project.worktree.branch}
        model={model}
        onCompleted={(url, openPage) => {
          prHandoffRef.current = true;
          setPrUrl(url);
          if (url && openPage) {
            openExternalUrl(url);
          }
          if (parentProjectId) {
            bumpProjectGitRefreshKey(parentProjectId);
          }
          void runCleanup({ deleteBranch: false });
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !prHandoffRef.current) {
            setPhase("review");
          }
        }}
        open
        projectPath={project.path}
        provider={provider}
        refreshToken={gitRefreshKey}
        status={compare?.worktreeStatus ?? null}
      />
    );
  }

  const dirtyChanges = compare?.worktreeStatus.changes ?? [];

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-5 sm:max-w-2xl">
        <GitDialogHeader
          icon={<FolderTree />}
          subtitle={
            compare
              ? `${compare.branch} -> ${compare.baseBranch}`
              : project.worktree.branch
          }
          title={worktreeT("completeWorktree")}
        />

        {phase === "working" ? (
          <div className="flex items-center gap-3 py-6 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            <span>{workingLabel}</span>
          </div>
        ) : phase === "done" ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border border-surface-200 bg-surface-50 px-3 py-3 text-sm dark:border-surface-800 dark:bg-surface-900">
              {mergeResult ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="space-y-1">
                    <div>
                      {mergeResult.fastForward
                        ? worktreeT("mergedFastForward", {
                            base: mergeResult.baseBranch,
                            branch: mergeResult.branch,
                          })
                        : worktreeT("mergedWithCommit", {
                            base: mergeResult.baseBranch,
                            branch: mergeResult.branch,
                            hash: mergeResult.mergeCommit.slice(0, 7),
                          })}
                    </div>
                    {mergeResult.previousMainBranch !==
                    mergeResult.baseBranch ? (
                      <div className="text-muted-foreground text-xs">
                        {worktreeT("mainNowOn", {
                          base: mergeResult.baseBranch,
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {prUrl !== null || (action === "pr" && prHandoffRef.current) ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span>{worktreeT("pullRequestCreated")}</span>
                    {prUrl ? (
                      <Button
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => openExternalUrl(prUrl)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ExternalLink className="size-3.5" />
                        {worktreeT("viewPullRequest")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {cleanupResult ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <div className="space-y-1">
                    <div>{worktreeT("worktreeRemoved")}</div>
                    {cleanupResult.branch ? (
                      <div className="text-muted-foreground text-xs">
                        {cleanupResult.branchDeleted
                          ? worktreeT("branchDeleted", {
                              branch: cleanupResult.branch,
                            })
                          : cleanupResult.branchDeleteError
                            ? worktreeT("branchDeleteFailed", {
                                branch: cleanupResult.branch,
                                error: cleanupResult.branchDeleteError,
                              })
                            : worktreeT("branchKept", {
                                branch: cleanupResult.branch,
                              })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : cleanupError ? (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="space-y-2">
                    <div>{worktreeT("cleanupFailed")}</div>
                    <div className="text-destructive text-xs">
                      {cleanupError}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              {cleanupError ? (
                <>
                  <Button
                    onClick={() => onOpenChange(false)}
                    type="button"
                    variant="ghost"
                  >
                    {commonT("close")}
                  </Button>
                  <Button
                    disabled={retryingCleanup}
                    onClick={() => void handleRetryCleanup()}
                    type="button"
                  >
                    {retryingCleanup ? <Spinner className="size-4" /> : null}
                    {worktreeT("retryRemoval")}
                  </Button>
                </>
              ) : (
                <Button onClick={finish} type="button">
                  {worktreeT("done")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {compareLoading && !compare ? (
                <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                  <Spinner className="size-4" />
                </div>
              ) : null}
              {compareError ? <ActionError error={compareError} /> : null}

              {compare ? (
                <>
                  <div className="space-y-2">
                    <DialogMetricRow
                      icon={<GitBranch className="size-4" />}
                      label={worktreeT("baseBranch")}
                      value={
                        <span className="text-foreground">
                          {compare.baseBranch}
                        </span>
                      }
                    />
                    <DialogMetricRow
                      icon={<GitCommitHorizontal className="size-4" />}
                      label={gitT("commits")}
                      value={
                        <span className="text-foreground">
                          {worktreeT("commitsAheadBehind", {
                            ahead: compare.aheadCount,
                            behind: compare.behindCount,
                          })}
                        </span>
                      }
                    />
                    <DialogMetricRow
                      icon={<FolderTree className="size-4" />}
                      label={commonT("files")}
                      value={<GitChangesDeltaSummary changes={compare.files} />}
                    />
                    <DialogMetricRow
                      icon={<Home className="size-4" />}
                      label={worktreeT("mainCheckout")}
                      value={
                        <span className="text-foreground">
                          {compare.mainBranch ?? commonT("unknown")}
                          <span
                            className={cn(
                              "ml-2",
                              compare.mainClean
                                ? "text-muted-foreground"
                                : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {compare.mainClean
                              ? worktreeT("clean")
                              : worktreeT("dirtyFiles", {
                                  count: compare.mainDirtyCount,
                                })}
                          </span>
                        </span>
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    {compare.mainBranch !== compare.baseBranch ? (
                      <InfoLine>
                        {worktreeT("mainWillSwitch", {
                          from: compare.mainBranch ?? commonT("unknown"),
                          to: compare.baseBranch,
                        })}
                      </InfoLine>
                    ) : null}
                    {!compare.baseExistsLocally ? (
                      <InfoLine>
                        {worktreeT("baseNotLocal", {
                          base: compare.baseBranch,
                        })}
                      </InfoLine>
                    ) : null}
                    {compare.behindCount > 0 ? (
                      <InfoLine>
                        {worktreeT("behindBase", {
                          base: compare.baseBranch,
                          count: compare.behindCount,
                        })}
                      </InfoLine>
                    ) : null}
                  </div>

                  {compare.commits.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900">
                      <div className="max-h-[10rem] divide-y divide-surface-200 overflow-y-auto dark:divide-surface-800">
                        {compare.commits.map((commit) => (
                          <div
                            className="grid h-9 grid-cols-[auto_1fr_auto] items-center gap-3 px-3 text-sm"
                            key={commit.hash || commit.shortHash}
                          >
                            <span className="font-mono text-muted-foreground text-xs">
                              {commit.shortHash}
                            </span>
                            <span className="min-w-0 truncate text-foreground">
                              {commit.subject || gitT("noSubject")}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {Number.isNaN(
                                new Date(commit.authorDate).getTime(),
                              )
                                ? ""
                                : format.dateTime(new Date(commit.authorDate), {
                                    day: "numeric",
                                    month: "short",
                                  })}
                            </span>
                          </div>
                        ))}
                      </div>
                      {compare.truncated ? (
                        <div className="border-surface-200 border-t px-3 py-2 text-muted-foreground text-xs dark:border-surface-800">
                          {gitT("showingCommits", {
                            shown: compare.commits.length,
                            total: compare.totalCommits,
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <InfoLine>
                      {worktreeT("noCommits", { base: compare.baseBranch })}
                    </InfoLine>
                  )}

                  {compare.files.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900">
                      <div className="max-h-[18rem] overflow-y-auto">
                        {compare.files.map((change) => (
                          <CompareFileRow
                            baseRef={project.worktree.baseRef}
                            change={change}
                            key={`${change.status}:${change.path}`}
                            projectPath={project.path}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {isDirty ? (
                    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="font-medium">
                            {worktreeT("uncommittedChanges", {
                              count: dirtyCount,
                            })}
                          </div>
                          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
                            {dirtyChanges
                              .slice(0, MAX_DIRTY_FILES_SHOWN)
                              .map((change) => (
                                <li className="truncate" key={change.path}>
                                  {change.path}
                                </li>
                              ))}
                            {dirtyChanges.length > MAX_DIRTY_FILES_SHOWN ? (
                              <li>
                                {worktreeT("andMoreFiles", {
                                  count:
                                    dirtyChanges.length - MAX_DIRTY_FILES_SHOWN,
                                })}
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label
                          className="flex cursor-pointer items-center gap-2 text-xs"
                          htmlFor="complete-worktree-discard"
                        >
                          <Checkbox
                            checked={discardUncommitted}
                            id="complete-worktree-discard"
                            onCheckedChange={(checked) =>
                              setDiscardUncommitted(checked === true)
                            }
                          />
                          <span>{worktreeT("discardUncommitted")}</span>
                        </label>
                        <Button
                          className="h-7 px-2 text-xs"
                          onClick={() => setPhase("commit")}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <GitCommitHorizontal className="size-3.5" />
                          {worktreeT("commitChangesFirst")}
                        </Button>
                      </div>
                      {discardUncommitted ? (
                        <InfoLine tone="warning">
                          {worktreeT("discardWarning")}
                        </InfoLine>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="space-y-2">
                <div className="font-medium text-muted-foreground text-xs">
                  {gitT("nextSteps")}
                </div>
                <NextStepSelector<WorktreeCompletionAction>
                  idPrefix="complete-worktree"
                  onValueChange={(value) => {
                    setActionTouched(true);
                    setAction(value);
                  }}
                  options={[
                    {
                      disabled: !mergeEnabled,
                      icon: <GitMerge />,
                      label: worktreeT("mergeIntoAndRemove", {
                        base: compare?.baseBranch ?? "",
                      }),
                      value: "merge",
                    },
                    {
                      disabled: !prEnabled,
                      icon: <GitPullRequest />,
                      label: worktreeT("createPrAndRemove"),
                      value: "pr",
                    },
                    {
                      icon: <FolderX />,
                      label: worktreeT("removeWorktreeOnly"),
                      value: "remove",
                    },
                  ]}
                  value={action}
                />
                {action === "merge" && mergeDisabledReason ? (
                  <InfoLine tone="warning">{mergeDisabledReason}</InfoLine>
                ) : action === "pr" && prDisabledReason ? (
                  <InfoLine tone="warning">{prDisabledReason}</InfoLine>
                ) : null}
              </div>

              {conflictingFiles.length > 0 ? (
                <div className="space-y-2 rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-sm">
                  <div className="text-destructive">{error}</div>
                  <div className="font-medium text-xs">
                    {worktreeT("conflictingFiles")}
                  </div>
                  <ul className="space-y-0.5 font-mono text-xs">
                    {conflictingFiles.map((file) => (
                      <li className="truncate" key={file}>
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ActionError error={error} />
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2">
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="ghost"
              >
                {commonT("cancel")}
              </Button>
              <Button
                className="min-w-36"
                disabled={primaryDisabled}
                onClick={handlePrimary}
                type="button"
                variant={action === "remove" ? "destructive" : "default"}
              >
                {primaryLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
