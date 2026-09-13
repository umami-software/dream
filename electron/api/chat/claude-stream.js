import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { claudeCode, getSessionInfo } from "ai-sdk-provider-claude-code";
import { resolveProjectPath } from "../project-git/files.js";
import {
  CLAUDE_REASONING_EFFORT_MAP,
  getModelReasoningEfforts,
  normalizeClaudeCodeModel,
} from "../providers/model-options.js";
import { resolveCliCommandPath } from "../shared/cli.js";
import { waitForToolApproval } from "../tool-approvals.js";
import {
  buildCodexMessageFilePartsSummary,
  getLatestUserMessage,
} from "./codex-prompt.js";
import { formatStreamError } from "./errors.js";
import {
  getProviderSessionMetadata,
  shouldResumeProviderSession,
} from "./provider-session.js";
import {
  DEFAULT_TOOL_STEP_LIMIT,
  REASONING_TOOL_STEP_LIMIT,
} from "./schema.js";

const CLAUDE_PERMISSION_MODE_MAP = {
  "ask-permissions": "default",
  "accept-edits": "acceptEdits",
  "bypass-permissions": "bypassPermissions",
};

const appendClaudeAttachmentTextToLatestUserMessage = (messages) => {
  const latestUserMessage = getLatestUserMessage(messages);
  const attachmentText = buildCodexMessageFilePartsSummary(latestUserMessage);
  if (!latestUserMessage || !attachmentText) {
    return messages;
  }

  const attachmentPrompt = [
    "Current turn attachments:",
    attachmentText,
    "Use these attachment contents as part of the user's latest request.",
  ].join("\n\n");

  return messages.map((message) =>
    message === latestUserMessage
      ? {
          ...message,
          parts: [
            ...(Array.isArray(message.parts) ? message.parts : []),
            {
              text: attachmentPrompt,
              type: "text",
            },
          ],
        }
      : message,
  );
};

const CLAUDE_ACCEPT_EDITS_ALLOWED_TOOLS = new Set([
  "edit",
  "exitplanmode",
  "glob",
  "grep",
  "ls",
  "multiedit",
  "notebookedit",
  "read",
  "write",
]);

const CLAUDE_BUILT_IN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "Bash",
  "BashOutput",
  "KillBash",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "EnterPlanMode",
  "AskUserQuestion",
  "ExitPlanMode",
];

const CLAUDE_ALLOWED_TOOLS = [...CLAUDE_BUILT_IN_TOOLS];

const CLAUDE_PRELOADED_TOOL_NAMES = new Set(
  CLAUDE_ALLOWED_TOOLS.map((toolName) => normalizeClaudeToolName(toolName)),
);

// Dream's chat transport is scoped to one request. Claude background agents can
// outlive that request, which closes the UI stream before their completion
// notifications arrive. Keep local subagents attached to the parent turn so
// the request remains open and their results continue streaming to the chat.
export const keepClaudeAgentAttachedToTurn = (toolName, input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const normalizedToolName = normalizeClaudeToolName(toolName);
  if (normalizedToolName !== "agent" && normalizedToolName !== "task") {
    return input;
  }

  if (input.run_in_background === false) {
    return input;
  }

  return {
    ...input,
    run_in_background: false,
  };
};

// PreToolUse hook wrapper for keepClaudeAgentAttachedToTurn. The canUseTool
// rewrite only runs when the SDK asks for permission, but Agent/Task is in
// `allowedTools` (and bypass mode skips permissions entirely), so the callback
// never fires for it. Hooks run before permission evaluation in every mode.
export const createClaudeAgentAttachmentHook = () => {
  return async (hookInput) => {
    const toolInput = hookInput?.tool_input;
    const attachedInput = keepClaudeAgentAttachedToTurn(
      hookInput?.tool_name,
      toolInput,
    );

    if (attachedInput === toolInput) {
      return { continue: true };
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: attachedInput,
      },
    };
  };
};

// Native file tools whose target paths must stay inside the project root.
const CLAUDE_PATH_GUARDED_TOOLS = new Set([
  "edit",
  "glob",
  "grep",
  "ls",
  "multiedit",
  "notebookedit",
  "read",
  "write",
]);

const CLAUDE_PATH_INPUT_KEYS = [
  "file_path",
  "filePath",
  "notebook_path",
  "notebookPath",
  "path",
];

const getClaudeToolInputPaths = (input) => {
  if (!input || typeof input !== "object") {
    return [];
  }

  return CLAUDE_PATH_INPUT_KEYS.map((key) => input[key]).filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
};

const findClaudeBlockedPath = (projectPath, toolName, input) => {
  if (
    !projectPath ||
    !CLAUDE_PATH_GUARDED_TOOLS.has(normalizeClaudeToolName(toolName))
  ) {
    return null;
  }

  for (const candidate of getClaudeToolInputPaths(input)) {
    try {
      resolveProjectPath(projectPath, candidate);
    } catch {
      return candidate;
    }
  }

  return null;
};

const getClaudeToolSearchQuery = (input) => {
  if (typeof input === "string") {
    return input.trim();
  }

  if (!input || typeof input !== "object") {
    return "";
  }

  const value =
    input.query ??
    input.pattern ??
    input.tool ??
    input.toolName ??
    input.tool_name ??
    input.name;
  return typeof value === "string" ? value.trim() : "";
};

const isPreloadedClaudeToolSearch = (input) => {
  const normalizedQuery = normalizeClaudeToolName(
    getClaudeToolSearchQuery(input),
  );
  if (!normalizedQuery) {
    return false;
  }

  for (const preloadedToolName of CLAUDE_PRELOADED_TOOL_NAMES) {
    if (
      normalizedQuery === preloadedToolName ||
      normalizedQuery.includes(preloadedToolName)
    ) {
      return true;
    }
  }

  return false;
};

const createClaudePermissionHandler = (writer, { mode, projectPath }) => {
  return async (toolName, input, options) => {
    const normalizedToolName = normalizeClaudeToolName(toolName);
    const attachedInput = keepClaudeAgentAttachedToTurn(toolName, input);
    const toolUseID =
      typeof options?.toolUseID === "string" ? options.toolUseID : undefined;

    if (
      normalizedToolName === "toolsearch" &&
      isPreloadedClaudeToolSearch(attachedInput)
    ) {
      return {
        behavior: "deny",
        interrupt: false,
        message:
          "That tool is already preloaded. Use it directly instead of ToolSearch.",
        ...(toolUseID ? { toolUseID } : {}),
      };
    }

    const blockedProjectPath = findClaudeBlockedPath(
      projectPath,
      toolName,
      attachedInput,
    );
    if (blockedProjectPath) {
      return {
        behavior: "deny",
        interrupt: false,
        message: `Path "${blockedProjectPath}" is outside the project root and cannot be accessed.`,
        ...(toolUseID ? { toolUseID } : {}),
      };
    }

    if (
      normalizedToolName !== "askuserquestion" &&
      mode === "accept-edits" &&
      CLAUDE_ACCEPT_EDITS_ALLOWED_TOOLS.has(normalizedToolName)
    ) {
      return {
        behavior: "allow",
        ...(options?.suggestions
          ? { updatedPermissions: options.suggestions }
          : {}),
        ...(toolUseID ? { toolUseID } : {}),
        updatedInput: attachedInput,
      };
    }

    if (normalizedToolName !== "askuserquestion" && mode === "bypass") {
      return {
        behavior: "allow",
        ...(options?.suggestions
          ? { updatedPermissions: options.suggestions }
          : {}),
        ...(toolUseID ? { toolUseID } : {}),
        updatedInput: attachedInput,
      };
    }

    if (normalizedToolName !== "askuserquestion" && mode === "accept-edits") {
      return {
        behavior: "deny",
        interrupt: false,
        message:
          "Accept edits only auto-approves file read and edit tools. Switch to Bypass permissions to allow this action.",
        ...(toolUseID ? { toolUseID } : {}),
      };
    }

    const toolCallId =
      typeof options?.toolUseID === "string" && options.toolUseID.length > 0
        ? options.toolUseID
        : `claude-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const approvalId = `anthropic:${toolCallId}`;
    const title =
      typeof options?.displayName === "string" && options.displayName.length > 0
        ? options.displayName
        : toolName;
    const approvalInput = {
      ...attachedInput,
      ...(typeof options?.title === "string" ? { title: options.title } : {}),
      ...(typeof options?.displayName === "string"
        ? { displayName: options.displayName }
        : {}),
      ...(typeof options?.description === "string"
        ? { description: options.description }
        : {}),
      ...(typeof options?.blockedPath === "string"
        ? { blockedPath: options.blockedPath }
        : {}),
      ...(typeof options?.decisionReason === "string"
        ? { decisionReason: options.decisionReason }
        : {}),
    };

    writer.write({
      dynamic: true,
      providerExecuted: true,
      title,
      toolCallId,
      toolName,
      type: "tool-input-start",
    });
    writer.write({
      dynamic: true,
      input: approvalInput,
      providerExecuted: true,
      title,
      toolCallId,
      toolName,
      type: "tool-input-available",
    });
    writer.write({
      approvalId,
      toolCallId,
      type: "tool-approval-request",
    });

    const response = await waitForToolApproval({
      id: approvalId,
      provider: "anthropic",
      request: {
        input: attachedInput,
        options: {
          blockedPath: options?.blockedPath ?? null,
          decisionReason: options?.decisionReason ?? null,
          description: options?.description ?? null,
          displayName: options?.displayName ?? null,
          title: options?.title ?? null,
          toolUseID: toolCallId,
        },
        toolName,
      },
      signal: options?.signal,
    });

    if (response.approved) {
      const questionApproval =
        normalizedToolName === "askuserquestion"
          ? parseAskUserQuestionApproval(response.reason)
          : null;

      if (questionApproval) {
        writer.write({
          dynamic: true,
          output: questionApproval,
          providerExecuted: true,
          toolCallId,
          type: "tool-output-available",
        });
      }

      return {
        behavior: "allow",
        ...(response.scope === "session" && options?.suggestions
          ? { updatedPermissions: options.suggestions }
          : {}),
        toolUseID: options?.toolUseID,
        updatedInput: questionApproval
          ? { ...attachedInput, ...questionApproval }
          : attachedInput,
      };
    }

    return {
      behavior: "deny",
      interrupt: false,
      message: response.reason || "User rejected the permission request.",
      toolUseID: options?.toolUseID,
    };
  };
};

function normalizeClaudeToolName(toolName) {
  return String(toolName ?? "")
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

const parseAskUserQuestionApproval = (reason) => {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(reason);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const answers =
      parsed.answers && typeof parsed.answers === "object"
        ? parsed.answers
        : null;
    const annotations =
      parsed.annotations && typeof parsed.annotations === "object"
        ? parsed.annotations
        : null;

    if (!answers) {
      return null;
    }

    return {
      answers,
      ...(annotations ? { annotations } : {}),
    };
  } catch {
    return null;
  }
};

export const streamClaudeResponse = async ({
  agentMode,
  claudePermissionMode,
  messages,
  model,
  modelSpeed,
  projectReferencesPrompt,
  projectPath,
  reasoningEffort,
  remoteConversationId,
  remoteConversationModel,
  remoteConversationModelSpeed,
  remoteConversationProjectPath,
  responseMessageMetadata,
}) => {
  const usesReasoningModel =
    getModelReasoningEfforts("anthropic", model).length > 0;
  const claudePermissionHandlerMode =
    agentMode === "plan"
      ? "ask"
      : claudePermissionMode === "accept-edits"
        ? "accept-edits"
        : claudePermissionMode === "bypass-permissions"
          ? "bypass"
          : "ask";
  const claudeExecutablePath = await resolveCliCommandPath("claude");
  let claudeCompactionId = null;
  let resumeSessionId = null;
  if (
    shouldResumeProviderSession({
      model,
      modelSpeed,
      projectPath,
      remoteConversationId,
      remoteConversationModel,
      remoteConversationModelSpeed,
      remoteConversationProjectPath,
    })
  ) {
    try {
      const sessionInfo = await getSessionInfo(remoteConversationId, {
        dir: projectPath,
      });
      if (sessionInfo?.sessionId === remoteConversationId) {
        resumeSessionId = remoteConversationId;
      }
    } catch (error) {
      console.warn(
        "[claude] Stored session could not be inspected; starting a new session.",
        error instanceof Error ? error.message : error,
      );
    }
  }
  const providerFactory = (modelId, writer) =>
    claudeCode(normalizeClaudeCodeModel(modelId), {
      ...(claudeExecutablePath
        ? { pathToClaudeCodeExecutable: claudeExecutablePath }
        : {}),
      canUseTool: createClaudePermissionHandler(writer, {
        mode: claudePermissionHandlerMode,
        projectPath,
      }),
      streamingInput: "auto",
      continue: false,
      cwd: projectPath,
      persistSession: true,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      hooks: {
        PostCompact: [
          {
            hooks: [
              async () => {
                const id =
                  claudeCompactionId ??
                  `claude-context-compaction-${Date.now()}`;
                writer.write({
                  data: { state: "compacted" },
                  id,
                  type: "data-context-compaction",
                });
                claudeCompactionId = null;
                return { continue: true };
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "^(Agent|Task)$",
            hooks: [createClaudeAgentAttachmentHook()],
          },
        ],
        PreCompact: [
          {
            hooks: [
              async () => {
                claudeCompactionId = `claude-context-compaction-${Date.now()}`;
                writer.write({
                  data: { state: "compacting" },
                  id: claudeCompactionId,
                  type: "data-context-compaction",
                });
                return { continue: true };
              },
            ],
          },
        ],
      },
      // `tools` controls the catalog shown to the model; `allowedTools` only
      // controls permission. Declare built-ins explicitly so plan-mode tools
      // are available directly instead of being discovered via ToolSearch.
      tools: CLAUDE_BUILT_IN_TOOLS,
      allowedTools: CLAUDE_ALLOWED_TOOLS,
      // Keep strict with no servers so user/global MCP config is not loaded.
      mcpServers: {},
      strictMcpConfig: true,
      // The provider defaults to `settingSources: []`, which isolates the SDK
      // from all filesystem config. Opt in so the user's ~/.claude/settings.json
      // (e.g. attribution overrides), project .claude/ settings, and CLAUDE.md
      // are honored, matching Claude Code CLI behavior.
      settingSources: ["user", "project", "local"],
      permissionMode:
        agentMode === "plan"
          ? "plan"
          : CLAUDE_PERMISSION_MODE_MAP[claudePermissionMode],
      ...(agentMode !== "plan" && claudePermissionMode === "bypass-permissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(usesReasoningModel
        ? { effort: CLAUDE_REASONING_EFFORT_MAP[reasoningEffort ?? "medium"] }
        : {}),
    });

  let modelMessages;
  try {
    const messagesForModel = resumeSessionId
      ? [getLatestUserMessage(messages)].filter(Boolean)
      : messages;
    modelMessages = await convertToModelMessages(
      appendClaudeAttachmentTextToLatestUserMessage(messagesForModel),
    );
  } catch (err) {
    console.error("[chat] Failed to convert messages:", err);
    const detail =
      err instanceof Error && err.message ? err.message : String(err);
    return new Response(`Failed to prepare messages: ${detail}`, {
      status: 400,
    });
  }

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: (error) => {
      console.error("[chat stream error]", error);
      return formatStreamError(error);
    },
    execute: ({ writer }) => {
      let claudeSessionId = resumeSessionId;
      const getClaudeResponseMetadata = () =>
        claudeSessionId
          ? getProviderSessionMetadata({
              model,
              modelSpeed,
              projectPath,
              responseMessageMetadata,
              sessionId: claudeSessionId,
            })
          : responseMessageMetadata;
      const textResult = streamText({
        messages: modelMessages,
        model: providerFactory(model, writer),
        stopWhen: isStepCount(
          usesReasoningModel
            ? REASONING_TOOL_STEP_LIMIT
            : DEFAULT_TOOL_STEP_LIMIT,
        ),
        ...(projectReferencesPrompt
          ? { instructions: projectReferencesPrompt }
          : {}),
      });

      writer.merge(
        toUIMessageStream({
          stream: textResult.stream,
          messageMetadata: ({ part }) => {
            if (part.type === "finish-step") {
              const sessionId =
                part.providerMetadata?.["claude-code"]?.sessionId;
              if (typeof sessionId === "string" && sessionId.trim()) {
                claudeSessionId = sessionId.trim();
                return getClaudeResponseMetadata();
              }
            }

            if (part.type === "finish") {
              return {
                ...getClaudeResponseMetadata(),
                usage: part.totalUsage,
              };
            }

            if (part.type === "start") {
              return getClaudeResponseMetadata();
            }

            return undefined;
          },
          onError: (error) => {
            console.error("[chat stream error]", error);
            return formatStreamError(error);
          },
        }),
      );
    },
  });
  return createUIMessageStreamResponse({ stream });
};
