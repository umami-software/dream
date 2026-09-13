import { spawn } from "node:child_process";
import { createOpencode } from "@opencode-ai/sdk";
import { generateText } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { runGrokPrompt } from "../providers/grok-acp.js";
import {
  CLAUDE_REASONING_EFFORT_MAP,
  getModelReasoningEfforts,
  normalizeClaudeCodeModel,
} from "../providers/model-options.js";
import { resolveCliCommandPath } from "../shared/cli.js";
import {
  getCodexCliSpawnErrorMessage,
  resolveCodexCliLaunch,
} from "./codex-cli-launch.js";
import { getCodexErrorDetail } from "./codex-prompt.js";

const CHAT_TITLE_MAX_LENGTH = 60;
const CHAT_TITLE_PROMPT_MAX_CHARS = 12_000;
const OPENCODE_TITLE_SERVER_TIMEOUT_MS = 10000;
const OPENCODE_TITLE_REQUEST_TIMEOUT_MS = 60000;
const CHAT_TITLE_SYSTEM_PROMPT =
  "Generate concise chat titles. Return only the title, with no quotes or extra commentary.";

const buildChatTitlePrompt = (promptText) => [
  "Create a short title for a new coding chat from the user's first message.",
  "Rules:",
  "- Use 3 to 6 words when possible.",
  `- Stay under ${CHAT_TITLE_MAX_LENGTH} characters.`,
  "- Do not wrap the title in quotes.",
  "- Do not end with punctuation unless it is part of a proper name.",
  "",
  "User message:",
  promptText,
];

const stripWrappingQuotes = (value) =>
  value.replace(/^["'`]+/, "").replace(/["'`]+$/, "");

export const sanitizeGeneratedChatTitle = (value) => {
  const title = stripWrappingQuotes(
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/[.!?]+$/, "")
    .trim();

  if (!title) {
    return "";
  }

  return title.slice(0, CHAT_TITLE_MAX_LENGTH).trim();
};

const LOCAL_TITLE_LEADING_FILLERS = new Set([
  "can",
  "could",
  "please",
  "would",
  "you",
]);

const toLocalTitleWord = (word) => {
  if (/^[A-Z0-9._/-]+$/.test(word)) {
    return word;
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

const generateLocalChatTitle = (promptText) => {
  const words = String(promptText ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#:[\]{}()]/g, " ")
    .match(/[a-zA-Z0-9][a-zA-Z0-9._/+:-]*/g);

  if (!words || words.length === 0) {
    return "";
  }

  const meaningfulWords = words.filter(
    (word, index) =>
      index > 3 || !LOCAL_TITLE_LEADING_FILLERS.has(word.toLowerCase()),
  );
  const titleWords = (meaningfulWords.length > 0 ? meaningfulWords : words)
    .slice(0, 6)
    .map(toLocalTitleWord);

  return sanitizeGeneratedChatTitle(titleWords.join(" ")) || "New Chat";
};

const parseCodexJsonLine = (line, onEvent) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  try {
    onEvent(JSON.parse(trimmed));
    return "";
  } catch {
    return `${trimmed}\n`;
  }
};

const generateCodexChatTitle = ({ model, projectPath, promptText }) =>
  new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let latestText = "";

    const handleEvent = (event) => {
      if (!event || typeof event !== "object") {
        return;
      }

      if (event.type === "error" || event.type === "turn.failed") {
        const detail = getCodexErrorDetail(event);
        if (detail) {
          stderrBuffer += `${detail}\n`;
        }
        return;
      }

      const item = event.item;
      if (
        event.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        latestText = item.text;
      }
    };

    const handleStdoutChunk = (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        stderrBuffer += parseCodexJsonLine(line, handleEvent);
      }
    };

    void resolveCodexCliLaunch()
      .then((launch) => {
        const child = spawn(
          launch.command,
          [
            ...launch.argsPrefix,
            "exec",
            "--json",
            "--cd",
            projectPath,
            "--skip-git-repo-check",
            "--model",
            model,
            "-c",
            'sandbox_mode="read-only"',
            "-c",
            'approval_policy="never"',
            "-c",
            'model_reasoning_effort="low"',
            "-",
          ],
          {
            env: process.env,
            shell: launch.shell ?? false,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        child.stdout.on("data", handleStdoutChunk);
        child.stderr.on("data", (chunk) => {
          stderrBuffer += chunk.toString();
        });
        child.on("error", (error) => {
          reject(new Error(getCodexCliSpawnErrorMessage(error)));
        });
        child.on("close", (code) => {
          stderrBuffer += parseCodexJsonLine(stdoutBuffer, handleEvent);

          if (code === 0) {
            resolve(sanitizeGeneratedChatTitle(latestText));
            return;
          }

          reject(
            new Error(
              stderrBuffer.trim() || `Codex CLI exited with code ${code}.`,
            ),
          );
        });

        child.stdin.end(
          [
            CHAT_TITLE_SYSTEM_PROMPT,
            "",
            buildChatTitlePrompt(promptText).join("\n"),
          ].join("\n"),
        );
      })
      .catch((error) => {
        reject(
          new Error(
            error instanceof Error
              ? error.message
              : "Codex CLI request failed.",
          ),
        );
      });
  });

const generateClaudeChatTitle = async ({ model, projectPath, promptText }) => {
  const usesReasoningModel =
    getModelReasoningEfforts("anthropic", model).length > 0;
  const claudeExecutablePath = await resolveCliCommandPath("claude");
  const result = await generateText({
    model: claudeCode(normalizeClaudeCodeModel(model), {
      ...(claudeExecutablePath
        ? { pathToClaudeCodeExecutable: claudeExecutablePath }
        : {}),
      continue: false,
      cwd: projectPath,
      persistSession: false,
      permissionMode: "plan",
      strictMcpConfig: true,
      ...(usesReasoningModel
        ? { effort: CLAUDE_REASONING_EFFORT_MAP.low }
        : {}),
    }),
    prompt: buildChatTitlePrompt(promptText).join("\n"),
    instructions: CHAT_TITLE_SYSTEM_PROMPT,
  });

  return sanitizeGeneratedChatTitle(result.text);
};

const generateGrokChatTitle = async ({ model, projectPath, promptText }) =>
  sanitizeGeneratedChatTitle(
    await runGrokPrompt({
      cwd: projectPath,
      model,
      prompt: [
        CHAT_TITLE_SYSTEM_PROMPT,
        "",
        buildChatTitlePrompt(promptText).join("\n"),
      ].join("\n"),
      timeoutMs: 60_000,
    }),
  );

const parseOpenCodeModel = (model) => {
  const [providerID, ...modelParts] = String(model ?? "").split("/");
  const modelID = modelParts.join("/");

  if (!providerID || !modelID) {
    throw new Error(
      "OpenCode model must use provider/model format, for example opencode-go/kimi-k2.6.",
    );
  }

  return { modelID, providerID };
};

const getOpenCodePartText = (part) =>
  part?.type === "text" && typeof part.text === "string" ? part.text : "";

const generateOpenCodeChatTitle = async ({
  model,
  projectPath,
  promptText,
}) => {
  const { modelID, providerID } = parseOpenCodeModel(model);
  const requestAbortController = new AbortController();
  const requestTimeout = setTimeout(() => {
    requestAbortController.abort();
  }, OPENCODE_TITLE_REQUEST_TIMEOUT_MS);
  let opencode = null;

  try {
    opencode = await createOpencode({
      hostname: "127.0.0.1",
      port: 0,
      signal: requestAbortController.signal,
      timeout: OPENCODE_TITLE_SERVER_TIMEOUT_MS,
    });

    const sessionResult = await opencode.client.session.create(
      {
        body: {
          agent: "plan",
          model: {
            id: modelID,
            providerID,
          },
        },
        query: { directory: projectPath },
      },
      { signal: requestAbortController.signal },
    );
    const sessionId = sessionResult.data?.id;

    if (!sessionId) {
      throw new Error("OpenCode did not return a session id.");
    }

    const promptResult = await opencode.client.session.prompt(
      {
        body: {
          agent: "plan",
          model: {
            modelID,
            providerID,
          },
          parts: [
            {
              text: [
                CHAT_TITLE_SYSTEM_PROMPT,
                "",
                buildChatTitlePrompt(promptText).join("\n"),
              ].join("\n"),
              type: "text",
            },
          ],
        },
        path: { id: sessionId },
        query: { directory: projectPath },
      },
      { signal: requestAbortController.signal },
    );

    return sanitizeGeneratedChatTitle(
      (promptResult.data?.parts ?? []).map(getOpenCodePartText).join(" "),
    );
  } finally {
    clearTimeout(requestTimeout);
    opencode?.server.close();
  }
};

export const generateChatTitle = async ({
  fallbackModel,
  projectPath,
  promptText,
  provider,
}) => {
  const normalizedPrompt = String(promptText ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedPrompt) {
    return "";
  }
  const titlePromptText =
    normalizedPrompt.length > CHAT_TITLE_PROMPT_MAX_CHARS
      ? `${normalizedPrompt.slice(0, CHAT_TITLE_PROMPT_MAX_CHARS)}\n\n[Message truncated for title generation.]`
      : normalizedPrompt;

  if (provider === "anthropic") {
    const model = fallbackModel?.trim() || "haiku";
    return generateClaudeChatTitle({
      model,
      projectPath,
      promptText: titlePromptText,
    });
  }

  if (provider === "opencode") {
    const model = fallbackModel?.trim();
    if (!model) {
      throw new Error("No OpenCode title model is available.");
    }
    return generateOpenCodeChatTitle({
      model,
      projectPath,
      promptText: titlePromptText,
    });
  }

  if (provider === "cursor") {
    return generateLocalChatTitle(titlePromptText);
  }

  if (provider === "grok") {
    const model = fallbackModel?.trim();
    if (!model) {
      return generateLocalChatTitle(titlePromptText);
    }
    return generateGrokChatTitle({
      model,
      projectPath,
      promptText: titlePromptText,
    });
  }

  const model = fallbackModel?.trim();
  if (!model) {
    throw new Error("No OpenAI title model is available.");
  }

  return generateCodexChatTitle({
    model,
    projectPath,
    promptText: titlePromptText,
  });
};
