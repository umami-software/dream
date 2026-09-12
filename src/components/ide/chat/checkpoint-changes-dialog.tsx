import {
  ChevronDown,
  ChevronRight,
  HistoryIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  CheckpointChangeEntry,
  CheckpointChangeStatus,
  CheckpointChangesResponse,
  CheckpointDiffResponse,
  CheckpointRestoreMode,
  CheckpointRestoreResponse,
  CheckpointRestoreResult,
} from "@/types/ide";
import { readResponseText } from "../changes/changes-row";
import { IdeDiffViewer } from "../diff-viewer";
import { MaterialFileIcon } from "../material-file-icon";
import { flushProjectPanelRefresh } from "../project-panel-refresh";

const STATUS_BADGE_CLASSNAMES: Record<CheckpointChangeStatus, string> = {
  added:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-success-surface dark:text-emerald-300 dark:ring-success-border",
  deleted:
    "bg-rose-50 text-rose-600 ring-rose-200 dark:bg-destructive-surface dark:text-rose-300 dark:ring-destructive-border-strong",
  modified:
    "bg-surface-100 text-muted-foreground ring-surface-300 dark:bg-surface-800 dark:ring-surface-700",
  renamed:
    "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
};

const STATUS_LABEL_KEYS: Record<
  CheckpointChangeStatus,
  "statusAdded" | "statusDeleted" | "statusModified" | "statusRenamed"
> = {
  added: "statusAdded",
  deleted: "statusDeleted",
  modified: "statusModified",
  renamed: "statusRenamed",
};

type DiffState = {
  data: CheckpointDiffResponse | null;
  error: string | null;
  loading: boolean;
};

const postJson = (route: string, body: unknown) =>
  fetch(route, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

export interface CheckpointChangesDialogProps {
  chatId: string;
  checkpointId: string;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId: string;
  projectPath: string;
}

export const CheckpointChangesDialog = ({
  chatId,
  checkpointId,
  disabled = false,
  onOpenChange,
  open,
  projectId,
  projectPath,
}: CheckpointChangesDialogProps) => {
  const t = useTranslations("checkpoints");
  const commonT = useTranslations("common");
  const [changes, setChanges] = useState<CheckpointChangesResponse | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [results, setResults] = useState<CheckpointRestoreResult[]>([]);

  const requestBody = useMemo(
    () => ({ chatId, checkpointId, projectPath }),
    [chatId, checkpointId, projectPath],
  );

  const loadChanges = useCallback(
    async ({ resetSelection }: { resetSelection: boolean }) => {
      setLoading(true);
      setLoadError(null);
      setNotFound(false);
      try {
        const response = await postJson("/api/checkpoint-changes", requestBody);
        if (response.status === 404) {
          setNotFound(true);
          setChanges(null);
          return;
        }
        if (!response.ok) {
          throw new Error(await readResponseText(response, t("loadFailed")));
        }
        const data = (await response.json()) as CheckpointChangesResponse;
        setChanges(data);
        if (resetSelection) {
          setSelected(
            new Set(
              data.files
                .filter((file) => !file.modifiedSince)
                .map((file) => file.filePath),
            ),
          );
        } else {
          setSelected((previous) => {
            const available = new Set(data.files.map((file) => file.filePath));
            return new Set([...previous].filter((p) => available.has(p)));
          });
        }
      } catch (error) {
        setChanges(null);
        setLoadError(error instanceof Error ? error.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [requestBody, t],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setResults([]);
    setRestoreError(null);
    setDiffs({});
    setExpanded(new Set());
    void loadChanges({ resetSelection: true });
  }, [loadChanges, open]);

  const loadDiff = useCallback(
    async (file: CheckpointChangeEntry) => {
      setDiffs((previous) => ({
        ...previous,
        [file.filePath]: { data: null, error: null, loading: true },
      }));
      try {
        const response = await postJson("/api/checkpoint-diff", {
          ...requestBody,
          filePath: file.filePath,
          previousPath: file.previousPath,
        });
        if (!response.ok) {
          throw new Error(await readResponseText(response, t("loadFailed")));
        }
        const data = (await response.json()) as CheckpointDiffResponse;
        setDiffs((previous) => ({
          ...previous,
          [file.filePath]: { data, error: null, loading: false },
        }));
      } catch (error) {
        setDiffs((previous) => ({
          ...previous,
          [file.filePath]: {
            data: null,
            error: error instanceof Error ? error.message : t("loadFailed"),
            loading: false,
          },
        }));
      }
    },
    [requestBody, t],
  );

  const toggleExpanded = (file: CheckpointChangeEntry) => {
    const willExpand = !expanded.has(file.filePath);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(file.filePath)) {
        next.delete(file.filePath);
      } else {
        next.add(file.filePath);
      }
      return next;
    });
    if (willExpand && !diffs[file.filePath]) {
      void loadDiff(file);
    }
  };

  const toggleSelected = (filePath: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(filePath);
      } else {
        next.delete(filePath);
      }
      return next;
    });
  };

  const files = changes?.files ?? [];
  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && !allSelected;

  const restore = useCallback(
    async (filePaths: string[], mode: CheckpointRestoreMode) => {
      if (filePaths.length === 0) {
        return;
      }
      setRestoring(true);
      setRestoreError(null);
      try {
        const response = await postJson("/api/checkpoint-restore", {
          ...requestBody,
          filePaths,
          mode,
        });
        if (!response.ok) {
          throw new Error(await readResponseText(response, t("restoreFailed")));
        }
        const data = (await response.json()) as CheckpointRestoreResponse;
        setResults((previous) => {
          const byPath = new Map(previous.map((r) => [r.filePath, r]));
          for (const result of data.results) {
            byPath.set(result.filePath, result);
          }
          return [...byPath.values()];
        });
        if (data.results.some((result) => result.status === "restored")) {
          flushProjectPanelRefresh(projectId);
          setDiffs({});
          await loadChanges({ resetSelection: false });
        }
      } catch (error) {
        setRestoreError(
          error instanceof Error ? error.message : t("restoreFailed"),
        );
      } finally {
        setRestoring(false);
      }
    },
    [loadChanges, projectId, requestBody, t],
  );

  const conflicts = results.filter((result) => result.status === "conflict");
  const errors = results.filter((result) => result.status === "error");
  const restoredCount = results.filter(
    (result) => result.status === "restored",
  ).length;
  const busy = loading || restoring;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base leading-6">
            <HistoryIcon className="size-4" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {changes
              ? t("filesChanged", { count: files.length })
              : t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {loading && !changes ? (
            <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              {commonT("loading")}
            </div>
          ) : notFound ? (
            <p className="p-6 text-center text-muted-foreground text-sm">
              {t("notFound")}
            </p>
          ) : loadError ? (
            <p className="p-6 text-center text-destructive text-sm">
              {loadError}
            </p>
          ) : files.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground text-sm">
              {t("emptyState")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {files.map((file) => {
                const isExpanded = expanded.has(file.filePath);
                const diffState = diffs[file.filePath];
                const result = results.find(
                  (entry) => entry.filePath === file.filePath,
                );
                return (
                  <li key={file.filePath}>
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      <Checkbox
                        aria-label={file.filePath}
                        checked={selected.has(file.filePath)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          toggleSelected(file.filePath, checked === true)
                        }
                      />
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => toggleExpanded(file)}
                        type="button"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <MaterialFileIcon
                          className="size-4 shrink-0"
                          path={file.filePath}
                        />
                        <span className="truncate font-mono text-xs">
                          {file.previousPath &&
                          file.previousPath !== file.filePath ? (
                            <>
                              <span className="text-muted-foreground">
                                {file.previousPath} →{" "}
                              </span>
                              {file.filePath}
                            </>
                          ) : (
                            file.filePath
                          )}
                        </span>
                      </button>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 font-semibold text-[10px] leading-4 ring-1",
                          STATUS_BADGE_CLASSNAMES[file.status],
                        )}
                      >
                        {t(STATUS_LABEL_KEYS[file.status])}
                      </span>
                      {file.modifiedSince ? (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-[10px] text-amber-700 leading-4 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
                          {t("editedLater")}
                        </span>
                      ) : null}
                      {result?.status === "restored" ? (
                        <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                          {t("restored")}
                        </span>
                      ) : null}
                      {!file.binary ? (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{file.additions}
                          </span>{" "}
                          <span className="text-rose-600 dark:text-rose-400">
                            −{file.deletions}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {isExpanded ? (
                      <div className="border-border border-t bg-surface-50 dark:bg-surface-950">
                        {!diffState || diffState.loading ? (
                          <div className="flex items-center gap-2 p-4 text-muted-foreground text-xs">
                            <Spinner className="size-3.5" />
                            {commonT("loading")}
                          </div>
                        ) : diffState.error ? (
                          <p className="p-4 text-destructive text-xs">
                            {diffState.error}
                          </p>
                        ) : diffState.data?.binary ? (
                          <p className="p-4 text-muted-foreground text-xs">
                            {t("binaryFile")}
                          </p>
                        ) : diffState.data?.parsedDiff ? (
                          <IdeDiffViewer
                            fileDiff={diffState.data.parsedDiff}
                            wordWrap
                          />
                        ) : (
                          <pre className="overflow-x-auto p-4 font-mono text-xs leading-5">
                            {diffState.data?.diff || t("noDiff")}
                          </pre>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {changes && !changes.complete ? (
          <p className="text-muted-foreground text-xs">{t("incompleteNote")}</p>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
            <div className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-amber-800 dark:text-amber-200">
                  {t("restoreConflict", { count: conflicts.length })}
                </p>
                <ul className="space-y-0.5 font-mono text-[11px] text-amber-900 dark:text-amber-100">
                  {conflicts.map((conflict) => (
                    <li className="truncate" key={conflict.filePath}>
                      {conflict.filePath}
                    </li>
                  ))}
                </ul>
                <Button
                  disabled={busy || disabled}
                  onClick={() =>
                    void restore(
                      conflicts.map((conflict) => conflict.filePath),
                      "overwrite",
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("overwriteAnyway")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {errors.length > 0 ? (
          <ul className="space-y-0.5 text-destructive text-xs">
            {errors.map((entry) => (
              <li className="truncate" key={entry.filePath}>
                {entry.filePath}
                {entry.message ? ` — ${entry.message}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {restoreError ? (
          <p className="text-destructive text-xs">{restoreError}</p>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Checkbox
              aria-label={t("selectAll")}
              checked={allSelected}
              disabled={busy || files.length === 0}
              indeterminate={someSelected}
              onCheckedChange={(checked) =>
                setSelected(
                  checked === true
                    ? new Set(files.map((file) => file.filePath))
                    : new Set(),
                )
              }
            />
            {t("selectAll")}
            {restoredCount > 0
              ? ` · ${t("restoredCount", { count: restoredCount })}`
              : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {commonT("close")}
            </Button>
            <Button
              disabled={busy || disabled || selected.size === 0}
              onClick={() => void restore([...selected], "merge")}
              type="button"
            >
              {restoring ? <Spinner className="size-3.5" /> : null}
              {t("restoreSelected", { count: selected.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
