import { FolderTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useProjectGitStatus } from "@/hooks/use-project-git-status";
import { cn } from "@/lib/utils";
import type { ProjectConfig, ProjectWorktreeInfo } from "@/types/ide";
import { BranchSwitcher } from "./branch-switcher";
import { CompleteWorktreeDialog } from "./git-actions/complete-worktree-dialog";
import { useIdeStore } from "./ide-store";
import { slugifyWorktreeBranchName, WorktreeFields } from "./worktree-fields";

const CreateWorktreeDialog = ({
  baseRef,
  onOpenChange,
  open,
  project,
}: {
  baseRef: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: ProjectConfig;
}) => {
  const commonT = useTranslations("common");
  const worktreeT = useTranslations("worktrees");
  const createWorktreeProject = useIdeStore((s) => s.createWorktreeProject);
  const [branchName, setBranchName] = useState("");
  const [baseRefValue, setBaseRefValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setBranchName(slugifyWorktreeBranchName(project.name));
    setBaseRefValue(baseRef ?? "");
    setError(null);
  }, [baseRef, open, project.name]);

  const canSubmit = branchName.trim().length > 0 && !submitting;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createWorktreeProject(project.id, {
        baseRef: baseRefValue.trim() || null,
        branchName: branchName.trim(),
      });
      onOpenChange(false);
    } catch {
      setError(worktreeT("unableToCreate"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{worktreeT("newWorktree")}</DialogTitle>
          <DialogDescription>
            {worktreeT("createDescription")}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <WorktreeFields
            autoFocus
            baseRef={baseRefValue}
            branchName={branchName}
            idPrefix="worktree"
            onBaseRefChange={setBaseRefValue}
            onBranchNameChange={setBranchName}
          />

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              {commonT("cancel")}
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {submitting ? (
                <>
                  <Spinner className="size-3.5" />
                  <span>{worktreeT("createWorktree")}</span>
                </>
              ) : (
                worktreeT("createWorktree")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const ProjectBranchFooter = ({
  className,
  project,
}: {
  className?: string;
  project: ProjectConfig;
}) => {
  const worktreeT = useTranslations("worktrees");
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[project.id] ?? 0,
  );
  const { branch, isRepo, loading } = useProjectGitStatus(
    project.path,
    gitRefreshKey,
    { detail: "summary" },
  );
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false);
  const [completeWorktreeOpen, setCompleteWorktreeOpen] = useState(false);

  if (!project.worktree && !isRepo && !loading) {
    return null;
  }

  return (
    <>
      <div className={cn("shrink-0 px-2 pt-1 pb-2", className)}>
        <div className="mx-auto flex w-full max-w-[700px] justify-end">
          {project?.worktree ? (
            <Button
              aria-label={worktreeT("completeWorktreeLabel", {
                branch: project.worktree.branch,
              })}
              className="h-7 max-w-[280px] gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => setCompleteWorktreeOpen(true)}
              size="sm"
              title={worktreeT("completeWorktreeLabel", {
                branch: project.worktree.branch,
              })}
              variant="ghost"
            >
              <FolderTree className="size-3.5 shrink-0" />
              <span className="shrink-0">{worktreeT("worktree")}</span>
              <span className="truncate text-foreground">
                {project.worktree.branch}
              </span>
            </Button>
          ) : project ? (
            <BranchSwitcher
              onCreateWorktree={
                isRepo ? () => setCreateWorktreeOpen(true) : undefined
              }
              projectId={project.id}
              projectPath={project.path}
            />
          ) : null}
        </div>
      </div>

      <CreateWorktreeDialog
        baseRef={branch}
        onOpenChange={setCreateWorktreeOpen}
        open={createWorktreeOpen}
        project={project}
      />
      {project.worktree ? (
        <CompleteWorktreeDialog
          onOpenChange={setCompleteWorktreeOpen}
          open={completeWorktreeOpen}
          project={project as ProjectConfig & { worktree: ProjectWorktreeInfo }}
        />
      ) : null}
    </>
  );
};
