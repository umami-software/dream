import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { ChatConfig, ProjectConfig } from "@/types/ide";

export function getFirstActiveDiffChatId(
  project: Pick<ProjectConfig, "id" | "ui"> | undefined,
  chats: Pick<ChatConfig, "id" | "projectId" | "deletedAt">[],
): string | null {
  if (!project) return null;
  return (
    [...project.ui.openChatIds, project.ui.activeChatId].find((id) =>
      chats.some(
        (chat) =>
          chat.id === id &&
          chat.projectId === project.id &&
          chat.deletedAt === null,
      ),
    ) ?? null
  );
}

function getMixedSelectionLines(
  diff: FileDiffMetadata,
  range: SelectedLineRange,
  style: "unified" | "split",
) {
  const rows: {
    position: number;
    side: "additions" | "deletions";
    line: number;
    text: string;
    changed: boolean;
  }[] = [];
  let position = 0;
  for (const hunk of diff.hunks) {
    for (const block of hunk.hunkContent) {
      const context = block.type === "context";
      const deletions = context ? block.lines : block.deletions;
      const additions = context ? block.lines : block.additions;
      for (const side of ["deletions", "additions"] as const) {
        const count = side === "deletions" ? deletions : additions;
        const index =
          side === "deletions"
            ? block.deletionLineIndex
            : block.additionLineIndex;
        const hunkIndex =
          side === "deletions"
            ? hunk.deletionLineIndex
            : hunk.additionLineIndex;
        const first =
          side === "deletions" ? hunk.deletionStart : hunk.additionStart;
        const lines =
          side === "deletions" ? diff.deletionLines : diff.additionLines;
        const offset =
          !context && style === "unified" && side === "additions"
            ? deletions
            : 0;
        for (let i = 0; i < count; i++) {
          rows.push({
            position: position + offset + i,
            side,
            line: first + index - hunkIndex + i,
            text: (lines[index + i] ?? "").replace(/\r?\n$/, ""),
            changed: !context,
          });
        }
      }
      position +=
        context || style === "split"
          ? Math.max(deletions, additions)
          : deletions + additions;
    }
  }
  const first = rows.find(
    (row) =>
      row.side === (range.side ?? "additions") && row.line === range.start,
  );
  const last = rows.find(
    (row) =>
      row.side === (range.endSide ?? range.side ?? "additions") &&
      row.line === range.end,
  );
  if (!first || !last) throw new Error("Select lines in the displayed diff.");
  return rows
    .filter(
      (row) =>
        row.position >= Math.min(first.position, last.position) &&
        row.position <= Math.max(first.position, last.position),
    )
    .sort((a, b) => a.position - b.position)
    .map(
      (row) =>
        `${row.changed ? (row.side === "deletions" ? "-" : "+") : " "} ${row.side === "deletions" ? "old" : "new"} ${row.line}: ${row.text}`,
    );
}

export function formatDiffReferenceMessage(
  filePath: string,
  diff: FileDiffMetadata,
  range: SelectedLineRange,
  message: string,
  previousPath?: string | null,
  diffStyle: "unified" | "split" = "unified",
) {
  const side = range.side ?? "additions";
  const mixed = !!range.endSide && range.endSide !== side;
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const lines = side === "additions" ? diff.additionLines : diff.deletionLines;
  const selected: string[] = mixed
    ? getMixedSelectionLines(diff, range, diffStyle)
    : [];
  for (const hunk of mixed ? [] : diff.hunks) {
    const first =
      side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const count =
      side === "additions" ? hunk.additionCount : hunk.deletionCount;
    const index =
      side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
    for (
      let line = Math.max(start, first);
      line <= Math.min(end, first + count - 1);
      line++
    ) {
      selected.push(
        `${line}: ${(lines[index + line - first] ?? "").replace(/\r?\n$/, "")}`,
      );
    }
  }
  if (!selected.length) throw new Error("Select lines in the displayed diff.");
  // Use a fence longer than any backtick run in the selected source.
  const source = selected.join("\n");
  const fence = "`".repeat(
    Math.max(
      3,
      ...Array.from(source.matchAll(/`+/g), (match) => match[0].length + 1),
    ),
  );
  const location = mixed
    ? `${range.side === "deletions" ? "old" : "new"} ${range.start} to ${range.endSide === "deletions" ? "old" : "new"} ${range.end} (both versions)`
    : `${start}-${end} (${side === "additions" ? "new" : "old"} version)`;
  return `${message}\n\nReferenced diff:\nFile: ${filePath}${previousPath ? ` (renamed from ${previousPath})` : ""}\nLines: ${location}\n\n${fence}text\n${source}\n${fence}`;
}
