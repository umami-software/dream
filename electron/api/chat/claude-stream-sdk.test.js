import assert from "node:assert/strict";
import { claudeCode, getSessionInfo } from "ai-sdk-provider-claude-code";
import { beforeEach, test, vi } from "vitest";
import { streamClaudeResponse } from "./claude-stream.js";

vi.mock("ai-sdk-provider-claude-code", () => ({
  claudeCode: vi.fn(),
  getSessionInfo: vi.fn(),
}));
vi.mock("../shared/cli.js", () => ({
  resolveCliCommandPath: vi.fn().mockResolvedValue(null),
}));

const usage = {
  inputTokens: { total: 10, noCache: 6, cacheRead: 4, cacheWrite: 0 },
  outputTokens: { total: 5, text: 3, reasoning: 2 },
};
let calls;
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  claudeCode.mockReturnValue({
    specificationVersion: "v4",
    provider: "claude-code",
    modelId: "haiku",
    supportedUrls: {},
    doStream: async (options) => {
      calls.push(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "Hello" },
              { type: "text-end", id: "text-1" },
              {
                type: "tool-call",
                toolCallId: "tool-1",
                toolName: "Read",
                input: '{"file_path":"missing.txt"}',
                providerExecuted: true,
                dynamic: true,
              },
              {
                type: "tool-result",
                toolCallId: "tool-1",
                toolName: "Read",
                result: "File not found",
                isError: true,
                providerExecuted: true,
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "end_turn" },
                usage,
                providerMetadata: { "claude-code": { sessionId: "session-1" } },
              },
            ])
              controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
});

const request = {
  agentMode: "agent",
  claudePermissionMode: "ask-permissions",
  model: "haiku",
  projectPath: "/tmp/dream-sdk-test",
  projectReferencesPrompt: "Use the referenced project.",
  messages: [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
  ],
};

const readChunks = async (response) => {
  assert.equal(response.status, 200);
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
};

test("streams v4 text, tool failures, session metadata and usage through the real AI SDK", async () => {
  const chunks = await readChunks(await streamClaudeResponse(request));
  assert.equal(
    chunks.some((part) => part.type === "error"),
    false,
  );
  assert.equal(
    chunks.find((part) => part.type === "text-delta").delta,
    "Hello",
  );
  assert.equal(
    chunks.find((part) => part.type === "tool-output-error").errorText,
    "File not found",
  );
  const metadata = chunks.find(
    (part) => part.type === "finish",
  ).messageMetadata;
  assert.equal(metadata.remoteConversationId, "session-1");
  assert.equal(metadata.usage.totalTokens, 15);
  assert.equal(metadata.usage.inputTokenDetails.cacheReadTokens, 4);
  assert.equal(metadata.usage.outputTokenDetails.reasoningTokens, 2);
  assert.deepEqual(calls[0].prompt[0], {
    role: "system",
    content: request.projectReferencesPrompt,
  });
});

test("resumes with only the latest turn and preserves image file inputs", async () => {
  getSessionInfo.mockResolvedValue({ sessionId: "session-1" });
  const chunks = await readChunks(
    await streamClaudeResponse({
      ...request,
      remoteConversationId: "session-1",
      remoteConversationModel: "haiku",
      remoteConversationProjectPath: request.projectPath,
      messages: [
        ...request.messages,
        {
          id: "user-2",
          role: "user",
          parts: [
            { type: "text", text: "Inspect this image" },
            {
              type: "file",
              mediaType: "image/png",
              url: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
        },
      ],
    }),
  );
  assert.equal(
    chunks.some((part) => part.type === "error"),
    false,
  );
  assert.equal(claudeCode.mock.calls[0][1].resume, "session-1");
  assert.equal(claudeCode.mock.calls[0][1].streamingInput, "auto");
  const users = calls[0].prompt.filter((message) => message.role === "user");
  assert.equal(users.length, 1);
  const image = users[0].content.find((part) => part.type === "file");
  assert.equal(image.mediaType, "image/png");
  assert.ok(image.data);
});
