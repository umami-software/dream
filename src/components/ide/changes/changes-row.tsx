import { ChevronDown, ChevronRight, Undo } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CodeBlockCopyButton } from "@/components/ai-elements/code-block";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  ProjectGitChangeStatus,
  ProjectGitDiffResponse,
  ProjectGitStatusEntry,
} from "@/types/ide";
import {
  DIFF_RENDER_CHANGED_LINE_LIMIT,
  IdeDiffViewer,
  LargeDiffGuard,
} from "../diff-viewer";
import { MaterialFileIcon } from "../material-file-icon";

export type DiffViewMode = "unified" | "split";

export interface ChangesPanelProps {
  active?: boolean;
  projectId?: string | null;
}

const CHANGE_STATUS_LABEL_CLASSNAMES: Partial<
  Record<ProjectGitChangeStatus, string>
> = {
  deleted:
    "rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold leading-4 text-rose-600 ring-1 ring-rose-200 dark:bg-destructive-surface dark:text-rose-300 dark:ring-destructive-border-strong",
  untracked:
    "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold leading-4 text-emerald-700 ring-1 ring-emerald-200 dark:bg-success-surface dark:text-emerald-300 dark:ring-success-border",
};

const DiffEmptyState = ({ diff }: { diff: string }) => {
  const panelsT = useTranslations("panels");
  if (diff.trim().length > 0) {
    return null;
  }

  return (
    <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
      {panelsT("noDiffOutput")}
    </pre>
  );
};

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const isImageFile = (filePath: string) => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
};

const getDeletedFileRawUrl = (projectPath: string, filePath: string) =>
  `/api/project-git-file-at-head-raw?projectPath=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(filePath)}`;

export const readResponseText = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  const text = await response.text();
  return text.trim() || fallback;
};

const DeletedImagePreview = ({
  filePath,
  projectPath,
}: {
  filePath: string;
  projectPath: string;
}) => {
  const panelsT = useTranslations("panels");
  const uiT = useTranslations("ui");
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadImage = async () => {
      setError(null);
      setImageUrl(null);

      try {
        const response = await fetch(
          getDeletedFileRawUrl(projectPath, filePath),
        );
        if (!response.ok) {
          throw new Error(
            await readResponseText(
              response,
              uiT("requestFailedStatus", { status: response.status }),
            ),
          );
        }

        objectUrl = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setImageUrl(objectUrl);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : panelsT("failedToReadImage"),
          );
        }
      }
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath, panelsT, projectPath, uiT]);

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-destructive text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground text-sm">
        <Spinner className="size-4" />
      </div>
    );
  }

  return (
    <div className="flex max-h-[560px] min-h-40 items-center justify-center overflow-auto bg-surface-100 p-6 dark:bg-surface-950">
      <img
        alt={filePath}
        className="max-h-[512px] max-w-full object-contain"
        src={imageUrl}
      />
    </div>
  );
};

const ExpandedDiffBody = ({
  change,
  diff,
  diffError,
  diffLoading,
  forceRenderDiff,
  mode,
  onForceRenderDiff,
  projectId,
  projectPath,
  wordWrap,
}: {
  change: ProjectGitStatusEntry;
  diff: ProjectGitDiffResponse | null;
  diffError: string | null;
  diffLoading: boolean;
  forceRenderDiff: boolean;
  mode: DiffViewMode;
  onForceRenderDiff: () => void;
  projectId: string;
  projectPath: string;
  wordWrap: boolean;
}) => {
  if (diffLoading && !diff) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground text-sm">
        <Spinner className="size-4" />
      </div>
    );
  }

  if (diffError) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-destructive text-sm">
          {diffError}
        </div>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground text-sm">
        <Spinner className="size-4" />
      </div>
    );
  }

  const showDeletedImage =
    change.status === "deleted" && isImageFile(change.path);
  const changedLineCount = change.addedLines + change.removedLines;
  const diffTooLarge =
    changedLineCount > DIFF_RENDER_CHANGED_LINE_LIMIT && !forceRenderDiff;

  return (
    <div className="bg-surface-50 dark:bg-surface-900">
      {change.previousPath ? (
        <div className="border-b border-surface-200 dark:border-surface-800 px-4 py-2 text-muted-foreground text-xs">
          {`${change.previousPath} -> ${change.path}`}
        </div>
      ) : null}
      <div
        className={cn(
          "text-xs",
          wordWrap ? "overflow-x-hidden" : "overflow-x-auto",
        )}
      >
        {showDeletedImage ? (
          <DeletedImagePreview
            filePath={change.path}
            projectPath={projectPath}
          />
        ) : (
          <DiffEmptyState diff={diff.diff} />
        )}
        {!showDeletedImage && diff.diff.trim().length > 0 && diffTooLarge ? (
          <LargeDiffGuard
            changedLineCount={changedLineCount}
            onRenderAnyway={onForceRenderDiff}
          />
        ) : !showDeletedImage && diff.diff.trim().length > 0 ? (
          diff.parsedDiff ? (
            <>
              {diff.parsedDiff.type === "deleted" ? (
                <div className="flex justify-end px-3 py-2">
                  <CodeBlockCopyButton
                    text={diff.parsedDiff.deletionLines.join("")}
                  />
                </div>
              ) : null}
              <IdeDiffViewer
                changedLineCount={changedLineCount}
                className={wordWrap ? "min-w-0" : "min-w-[720px]"}
                diffStyle={mode}
                fileDiff={diff.parsedDiff}
                feedback={{
                  projectId,
                  filePath: change.path,
                  previousPath: change.previousPath,
                }}
                largeDiffGuardEnabled={false}
                wordWrap={wordWrap}
              />
            </>
          ) : (
            <pre
              className={cn(
                "dream-diff-viewer w-full bg-surface-100 dark:bg-surface-900 p-4 font-mono text-xs",
                wordWrap
                  ? "overflow-x-hidden whitespace-pre-wrap break-words"
                  : "overflow-x-auto whitespace-pre",
              )}
            >
              {diff.diff}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
};

const formatChangeCount = (value: number, prefix: "+" | "-") =>
  `${prefix}${value}`;

export const ChangesRow = ({
  change,
  diff,
  diffError,
  diffLoading,
  expanded,
  forceRenderDiff,
  mode,
  onForceRenderDiff,
  onRevert,
  onToggle,
  projectId,
  projectPath,
  reverting,
  wordWrap,
}: {
  change: ProjectGitStatusEntry;
  diff: ProjectGitDiffResponse | null;
  diffError: string | null;
  diffLoading: boolean;
  expanded: boolean;
  forceRenderDiff: boolean;
  mode: DiffViewMode;
  onForceRenderDiff: () => void;
  onRevert: () => void;
  onToggle: () => void;
  projectId: string;
  projectPath: string;
  reverting: boolean;
  wordWrap: boolean;
}) => {
  const panelsT = useTranslations("panels");
  const statusLabel =
    change.status === "deleted"
      ? panelsT("removed")
      : change.status === "renamed"
        ? panelsT("renamed")
        : change.status === "untracked"
          ? panelsT("newFile")
          : null;
  const hasAddedLines = typeof change.addedLines === "number";
  const hasRemovedLines = typeof change.removedLines === "number";

  return (
    <div className="border-b border-surface-200 dark:border-surface-700 bg-background">
      <div
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left",
          expanded
            ? "sticky top-0 z-30 border-b border-surface-200 dark:border-surface-700 bg-background"
            : "hover:bg-surface-100 dark:hover:bg-surface-900",
        )}
      >
        <button
          aria-label={
            expanded ? panelsT("collapseFileDiff") : panelsT("expandFileDiff")
          }
          aria-expanded={expanded}
          className="absolute inset-0 z-0 rounded-none focus-visible:outline-2 focus-visible:outline-surface-400 focus-visible:-outline-offset-2 dark:focus-visible:outline-surface-500"
          onClick={onToggle}
          title={
            expanded ? panelsT("collapseFileDiff") : panelsT("expandFileDiff")
          }
          type="button"
        />

        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2">
          <MaterialFileIcon className="size-4 shrink-0" path={change.path} />
          <span className="min-w-0 truncate font-mono text-xs">
            {change.path}
          </span>
          {statusLabel ? (
            <span
              className={cn(
                "shrink-0 font-medium font-sans",
                CHANGE_STATUS_LABEL_CLASSNAMES[change.status] ??
                  "text-muted-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>

        <div className="pointer-events-none relative z-10 ml-auto flex shrink-0 items-center gap-2 font-mono text-sm tabular-nums">
          <button
            aria-label={panelsT("revertNamedFile", { path: change.path })}
            className="pointer-events-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={reverting}
            onClick={onRevert}
            title={panelsT("revertFileChanges")}
            type="button"
          >
            {reverting ? (
              <Spinner className="size-3.5" />
            ) : (
              <Undo className="size-3.5" />
            )}
          </button>
          {hasAddedLines ? (
            <span className="font-medium text-emerald-600">
              {formatChangeCount(change.addedLines, "+")}
            </span>
          ) : null}
          {hasRemovedLines ? (
            <span className="font-medium text-rose-600">
              {formatChangeCount(change.removedLines, "-")}
            </span>
          ) : null}
          <span className="flex size-7 items-center justify-center text-muted-foreground">
            {expanded ? (
              <ChevronDown className="size-4 shrink-0" />
            ) : (
              <ChevronRight className="size-4 shrink-0" />
            )}
          </span>
        </div>
      </div>

      {expanded ? (
        <ExpandedDiffBody
          change={change}
          diff={diff}
          diffError={diffError}
          diffLoading={diffLoading}
          forceRenderDiff={forceRenderDiff}
          mode={mode}
          onForceRenderDiff={onForceRenderDiff}
          projectId={projectId}
          projectPath={projectPath}
          wordWrap={wordWrap}
        />
      ) : null}
    </div>
  );
};
