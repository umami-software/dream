import { z } from "zod";

export const projectFilesRequestSchema = z.object({
  directory: z.string().min(1).default("."),
  maxResults: z.number().int().min(1).max(50_000).default(2000),
  projectPath: z.string().min(1),
});

export const projectDirectoryRequestSchema = z.object({
  directory: z.string().min(1).default("."),
  projectPath: z.string().min(1),
});

export const projectFileRequestSchema = z.object({
  endLine: z.number().int().min(1).optional(),
  filePath: z.string().min(1),
  projectPath: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
});

export const projectFileWriteRequestSchema = z.object({
  content: z.string(),
  expectedContent: z.string(),
  filePath: z.string().min(1),
  projectPath: z.string().min(1),
});

export const projectIconRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const projectGitStatusRequestSchema = z.object({
  detail: z.enum(["full", "summary"]).default("full"),
  projectPath: z.string().min(1),
});

export const projectGitBranchesRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const projectGitCheckoutRequestSchema = z.object({
  branchName: z.string().min(1),
  create: z.boolean().default(false),
  projectPath: z.string().min(1),
});

export const projectGitWorktreesRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const projectGitCreateWorktreeRequestSchema = z.object({
  baseRef: z.string().trim().optional().nullable(),
  branchName: z.string().min(1),
  projectPath: z.string().min(1),
});

export const projectGitRemoveWorktreeRequestSchema = z.object({
  force: z.boolean().default(false),
  projectPath: z.string().min(1),
  worktreePath: z.string().min(1),
});

export const projectGitDiffRequestSchema = z.object({
  filePath: z.string().min(1),
  previousPath: z.string().min(1).nullable(),
  projectPath: z.string().min(1),
  status: z.enum([
    "modified",
    "added",
    "renamed",
    "copied",
    "deleted",
    "untracked",
  ]),
});

export const projectGitRevertFileRequestSchema = projectGitDiffRequestSchema;

const nullableTrimmedStringSchema = z
  .string()
  .transform((value) => value.trim())
  .optional()
  .nullable();

export const projectGitCommitRequestSchema = z.object({
  customInstructions: nullableTrimmedStringSchema,
  includeUnstaged: z.boolean().default(true),
  message: nullableTrimmedStringSchema,
  projectPath: z.string().min(1),
});

export const projectGitCommitMessageRequestSchema = z.object({
  includeUnstaged: z.boolean().default(true),
  model: nullableTrimmedStringSchema,
  projectPath: z.string().min(1),
  provider: z
    .enum(["openai", "anthropic", "opencode", "cursor", "grok"])
    .default("openai"),
});

export const projectGitPushRequestSchema = z.object({
  commitMessage: nullableTrimmedStringSchema,
  customInstructions: nullableTrimmedStringSchema,
  includeUnstaged: z.boolean().default(true),
  nextStep: z.enum(["push", "commit-push"]).default("push"),
  projectPath: z.string().min(1),
});

export const projectGitPushPreviewRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const projectGitCreatePullRequestSchema = z.object({
  baseBranch: nullableTrimmedStringSchema,
  commitMessage: nullableTrimmedStringSchema,
  customInstructions: nullableTrimmedStringSchema,
  description: nullableTrimmedStringSchema,
  draft: z.boolean().default(true),
  includeUnstaged: z.boolean().default(true),
  nextStep: z
    .enum(["create", "push-create", "commit-push-create"])
    .default("create"),
  openPrPage: z.boolean().default(false),
  projectPath: z.string().min(1),
  title: nullableTrimmedStringSchema,
});

export const projectGitPullRequestDetailsRequestSchema = z.object({
  baseBranch: nullableTrimmedStringSchema,
  customInstructions: nullableTrimmedStringSchema,
  includeUnstaged: z.boolean().default(true),
  model: nullableTrimmedStringSchema,
  nextStep: z
    .enum(["create", "push-create", "commit-push-create"])
    .default("create"),
  projectPath: z.string().min(1),
  provider: z
    .enum(["openai", "anthropic", "opencode", "cursor", "grok"])
    .default("openai"),
});

export const projectGitWorktreeCompareRequestSchema = z.object({
  baseRef: nullableTrimmedStringSchema,
  projectPath: z.string().min(1),
});

export const projectGitWorktreeCompareDiffRequestSchema =
  projectGitWorktreeCompareRequestSchema.extend({
    filePath: z.string().min(1),
    previousPath: z.string().min(1).nullable(),
    status: z.enum([
      "modified",
      "added",
      "renamed",
      "copied",
      "deleted",
      "untracked",
    ]),
  });

export const projectGitWorktreeMergeRequestSchema = z.object({
  acknowledgeUncommitted: z.boolean().default(false),
  baseRef: nullableTrimmedStringSchema,
  projectPath: z.string().min(1),
});

export const projectGitWorktreeCleanupRequestSchema = z.object({
  deleteBranch: z.boolean().default(false),
  force: z.boolean().default(false),
  projectPath: z.string().min(1),
  worktreePath: z.string().min(1),
});
