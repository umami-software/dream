import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);

export const checkpointChangesRequestSchema = z.object({
  chatId: identifierSchema,
  checkpointId: identifierSchema,
  projectPath: z.string().min(1),
});

export const checkpointDiffRequestSchema =
  checkpointChangesRequestSchema.extend({
    filePath: z.string().min(1),
    previousPath: z.string().min(1).nullable().optional(),
  });

export const checkpointDeleteChatsRequestSchema = z.object({
  chatIds: z.array(identifierSchema).min(1).max(1000),
  projectPath: z.string().min(1),
});

export const checkpointDeleteProjectRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const checkpointRestoreRequestSchema =
  checkpointChangesRequestSchema.extend({
    filePaths: z.array(z.string().min(1)).min(1).max(500),
    mode: z.enum(["merge", "overwrite"]).default("merge"),
  });
