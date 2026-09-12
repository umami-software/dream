import {
  checkpointChangesRequestSchema,
  checkpointDeleteChatsRequestSchema,
  checkpointDeleteProjectRequestSchema,
  checkpointDiffRequestSchema,
  checkpointRestoreRequestSchema,
} from "./checkpoints/schemas.js";
import {
  CheckpointNotFoundError,
  deleteChatCheckpoints,
  deleteProjectCheckpoints,
  getCheckpointFileDiff,
  listCheckpointChanges,
  restoreCheckpointFiles,
} from "./checkpoints/service.js";
import { ensureProjectDirectory } from "./project-git/files.js";

const handleCheckpointRequest = async (
  c,
  schema,
  handler,
  { requireProjectDirectory = true } = {},
) => {
  let rawBody;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.text("Invalid JSON payload.", 400);
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return c.text(parsed.error.message, 400);
  }

  try {
    if (requireProjectDirectory) {
      await ensureProjectDirectory(parsed.data.projectPath);
    }
    return c.json(await handler(parsed.data));
  } catch (error) {
    if (error instanceof CheckpointNotFoundError) {
      return c.text(error.message, 404);
    }
    const message =
      error instanceof Error ? error.message : "Checkpoint request failed.";
    return c.text(message, 400);
  }
};

export const registerCheckpointRoutes = (app) => {
  app.post("/api/checkpoint-changes", (c) =>
    handleCheckpointRequest(c, checkpointChangesRequestSchema, (data) =>
      listCheckpointChanges(data),
    ),
  );

  app.post("/api/checkpoint-diff", (c) =>
    handleCheckpointRequest(c, checkpointDiffRequestSchema, (data) =>
      getCheckpointFileDiff(data),
    ),
  );

  app.post("/api/checkpoint-restore", (c) =>
    handleCheckpointRequest(c, checkpointRestoreRequestSchema, (data) =>
      restoreCheckpointFiles(data),
    ),
  );

  app.post("/api/checkpoint-delete-chats", (c) =>
    handleCheckpointRequest(
      c,
      checkpointDeleteChatsRequestSchema,
      async ({ chatIds, projectPath }) => {
        let deletedRefs = 0;
        for (const chatId of chatIds) {
          deletedRefs += await deleteChatCheckpoints({ chatId, projectPath });
        }
        return { deletedRefs };
      },
      { requireProjectDirectory: false },
    ),
  );

  app.post("/api/checkpoint-delete-project", (c) =>
    handleCheckpointRequest(
      c,
      checkpointDeleteProjectRequestSchema,
      async ({ projectPath }) => {
        await deleteProjectCheckpoints(projectPath);
        return { deleted: true };
      },
      { requireProjectDirectory: false },
    ),
  );
};
