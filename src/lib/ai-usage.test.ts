import type { LanguageModelUsage } from "ai";
import { expect, test } from "vitest";
import { getUsageCacheReadTokens, getUsageReasoningTokens } from "./ai-usage";

test("reads older saved usage and prefers v7 detail fields, including zero", () => {
  const legacy = {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cachedInputTokens: 4,
    reasoningTokens: 2,
  };
  // Persisted metadata is loaded as JSON and can predate the current SDK.
  const saved = legacy;
  expect(getUsageCacheReadTokens(saved)).toBe(4);
  expect(getUsageReasoningTokens(saved)).toBe(2);
  const current: LanguageModelUsage = {
    ...saved,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  };
  expect(getUsageCacheReadTokens(current)).toBe(0);
  expect(getUsageReasoningTokens(current)).toBe(0);
  expect(getUsageCacheReadTokens(undefined)).toBe(0);
  expect(getUsageReasoningTokens(undefined)).toBe(0);
});
