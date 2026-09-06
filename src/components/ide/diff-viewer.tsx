import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type DiffFeedbackTarget,
  InlineDiffFeedback,
} from "./inline-diff-feedback";

type DiffViewMode = "unified" | "split";
type PierreDiffOptions = NonNullable<FileDiffProps<undefined>["options"]>;
type ParsedFileDiff = FileDiffProps<undefined>["fileDiff"];

export const DIFF_RENDER_CHANGED_LINE_LIMIT = 500;

const DIFF_UNMODIFIED_LINES_CSS = `
[data-separator='line-info'] {
  margin-block: 0;
  background-color: var(--color-muted);
}

[data-separator='line-info'] [data-separator-wrapper],
[data-separator='line-info'] [data-expand-button],
[data-separator='line-info'] [data-separator-content] {
  background-color: var(--color-muted);
}

[data-separator='line-info'] [data-separator-content] {
  padding-inline: 0;
}

[data-separator='line-info'] [data-expand-button] {
  border-right-color: transparent;
}

[data-separator='line-info'] [data-expand-up],
[data-separator='line-info'] [data-expand-down] {
  border-color: transparent;
}
`;

const getFileDiffChangedLineCount = (fileDiff: ParsedFileDiff) =>
  fileDiff?.hunks.reduce(
    (total, hunk) => total + hunk.additionLines + hunk.deletionLines,
    0,
  ) ?? 0;

export const LargeDiffGuard = ({
  changedLineCount,
  limit = DIFF_RENDER_CHANGED_LINE_LIMIT,
  onRenderAnyway,
}: {
  changedLineCount: number;
  limit?: number;
  onRenderAnyway: () => void;
}) => {
  const panelsT = useTranslations("panels");

  return (
    <div className="px-4 py-4 text-sm">
      <div className="font-medium text-foreground">
        {panelsT("diffTooLarge")}
      </div>
      <div className="mt-2 text-muted-foreground">
        {panelsT("diffLineLimit", { current: changedLineCount, limit })}
      </div>
      <Button
        className="mt-3"
        onClick={onRenderAnyway}
        size="sm"
        type="button"
        variant="outline"
      >
        {panelsT("renderAnyway")}
      </Button>
    </div>
  );
};

export const IdeDiffViewer = ({
  changedLineCount,
  className,
  diffStyle = "unified",
  fileDiff,
  feedback,
  largeDiffGuardEnabled = true,
  renderChangedLineLimit = DIFF_RENDER_CHANGED_LINE_LIMIT,
  wordWrap = false,
}: {
  changedLineCount?: number;
  className?: string;
  diffStyle?: DiffViewMode;
  fileDiff: ParsedFileDiff;
  feedback?: DiffFeedbackTarget;
  largeDiffGuardEnabled?: boolean;
  renderChangedLineLimit?: number;
  wordWrap?: boolean;
}) => {
  const { resolvedTheme } = useTheme();
  const [renderAnyway, setRenderAnyway] = useState(false);
  const resolvedChangedLineCount =
    changedLineCount ?? getFileDiffChangedLineCount(fileDiff);
  const diffOptions = useMemo<PierreDiffOptions>(
    () => ({
      diffIndicators: "bars",
      diffStyle,
      disableFileHeader: true,
      hunkSeparators: "line-info",
      lineDiffType: "none",
      overflow: wordWrap ? "wrap" : "scroll",
      theme: {
        dark: "github-dark",
        light: "github-light",
      },
      themeType: resolvedTheme === "dark" ? "dark" : "light",
      unsafeCSS: DIFF_UNMODIFIED_LINES_CSS,
    }),
    [diffStyle, resolvedTheme, wordWrap],
  );

  if (
    largeDiffGuardEnabled &&
    resolvedChangedLineCount > renderChangedLineLimit &&
    !renderAnyway
  ) {
    return (
      <div className={cn("dream-diff-surface", className)}>
        <LargeDiffGuard
          changedLineCount={resolvedChangedLineCount}
          limit={renderChangedLineLimit}
          onRenderAnyway={() => setRenderAnyway(true)}
        />
      </div>
    );
  }

  return (
    <div className={cn("dream-diff-surface", className)}>
      {feedback ? (
        <InlineDiffFeedback
          fileDiff={fileDiff}
          options={diffOptions}
          target={feedback}
        />
      ) : (
        <FileDiff
          className="dream-diff-viewer w-full min-w-0"
          fileDiff={fileDiff}
          options={diffOptions}
        />
      )}
    </div>
  );
};
