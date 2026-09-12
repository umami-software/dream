import { z } from "zod";

export const chatRequestBodySchema = z.object({
  permissionMode: z.enum(["standard", "full-access"]).default("full-access"),
  messages: z.array(z.unknown()),
  model: z.string().min(1),
  modelLabel: z.string().min(1).optional(),
  projectReferences: z
    .array(
      z.object({
        kind: z.enum(["file", "folder"]),
        name: z.string().min(1).optional(),
        parentPath: z.string().optional(),
        path: z.string().min(1),
      }),
    )
    .default([]),
  projectPath: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "opencode", "cursor", "grok"]),
  agentMode: z.enum(["plan", "build"]).default("build"),
  remoteConversationId: z.string().nullable().optional(),
  remoteConversationModel: z.string().nullable().optional(),
  remoteConversationModelSpeed: z
    .enum(["standard", "fast"])
    .nullable()
    .optional(),
  remoteConversationProjectPath: z.string().nullable().optional(),
  modelSpeed: z.enum(["standard", "fast"]).default("standard"),
  modelSpeedLabel: z.string().min(1).optional(),
  reasoningEffort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .nullable()
    .optional(),
  reasoningLabel: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
  checkpointsEnabled: z.boolean().default(true),
  projectId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
});

export const formatProjectReferencesForPrompt = (projectReferences) => {
  if (!Array.isArray(projectReferences) || projectReferences.length === 0) {
    return null;
  }

  const lines = projectReferences.map((reference) => {
    const kind = reference.kind === "folder" ? "folder" : "file";
    const name = reference.name ? ` (${reference.name})` : "";
    return `- ${kind}${name}: ${reference.path}`;
  });

  return [
    "Current turn project references:",
    ...lines,
    "Use these referenced project paths as the user's selected context. Read referenced files or inspect referenced folders with the project tools before making claims about their contents.",
  ].join("\n");
};

export const chatTitleRequestBodySchema = z.object({
  fallbackModel: z.string().min(1).optional(),
  projectPath: z.string().min(1),
  promptText: z.string(),
  provider: z.enum(["openai", "anthropic", "opencode", "cursor", "grok"]),
});

export const DEFAULT_TOOL_STEP_LIMIT = 8;
export const REASONING_TOOL_STEP_LIMIT = 50;
