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

export const checkpointRestoreRequestSchema =
  checkpointChangesRequestSchema.extend({
    filePaths: z.array(z.string().min(1)).min(1).max(500),
    mode: z.enum(["merge", "overwrite"]).default("merge"),
  });
