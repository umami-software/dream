import type { LanguageModelUsage } from "ai";

// Saved chats may still contain the flat fields removed in AI SDK 7.
type PersistedUsage = Partial<LanguageModelUsage> & {
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export const getUsageCacheReadTokens = (usage: PersistedUsage | undefined) =>
  usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0;

export const getUsageReasoningTokens = (usage: PersistedUsage | undefined) =>
  usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0;
