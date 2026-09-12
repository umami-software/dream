import type { ChatConfig, ProjectConfig } from "@/types/ide";

const postJson = async (route: string, body: unknown) => {
  try {
    await fetch(route, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    // Checkpoint cleanup is best-effort; leftover snapshots are harmless.
  }
};

/**
 * Drops the checkpoint snapshots that belong to chats being permanently
 * deleted. Runs fire-and-forget; the store never waits on it.
 */
export const requestChatCheckpointCleanup = (
  chats: ChatConfig[],
  projects: ProjectConfig[],
) => {
  if (chats.length === 0 || typeof fetch !== "function") {
    return;
  }

  const projectPathById = new Map(
    projects.map((project) => [project.id, project.path]),
  );
  const chatIdsByProjectPath = new Map<string, string[]>();
  for (const chat of chats) {
    const projectPath = projectPathById.get(chat.projectId);
    if (!projectPath) {
      continue;
    }
    const chatIds = chatIdsByProjectPath.get(projectPath) ?? [];
    chatIds.push(chat.id);
    chatIdsByProjectPath.set(projectPath, chatIds);
  }

  for (const [projectPath, chatIds] of chatIdsByProjectPath) {
    void postJson("/api/checkpoint-delete-chats", { chatIds, projectPath });
  }
};

/**
 * Drops every checkpoint snapshot for a project whose directory is going away
 * (for example a removed worktree).
 */
export const requestProjectCheckpointCleanup = (projectPath: string) => {
  if (!projectPath || typeof fetch !== "function") {
    return;
  }
  void postJson("/api/checkpoint-delete-project", { projectPath });
};
