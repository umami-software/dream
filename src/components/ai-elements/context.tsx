import type { LanguageModelUsage } from "ai";
import type { ComponentProps, ReactElement } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createContext, useContext, useMemo } from "react";
import { getUsage } from "tokenlens";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { getUsageCacheReadTokens, getUsageReasoningTokens } from "@/lib/ai-usage";
import { cn } from "@/lib/utils";

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

type ModelId = string;

interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  usage?: LanguageModelUsage;
  modelId?: ModelId;
}

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);

  if (!context) {
    throw new Error("Context components must be used within Context");
  }

  return context;
};

const clampPercent = (value: number) =>
  Math.min(PERCENT_MAX, Math.max(0, value));

const clampRatio = (value: number) => Math.min(1, Math.max(0, value));

const getUsageBillableInputTokens = (
  usage: LanguageModelUsage | undefined,
) => {
  const inputTokens = usage?.inputTokens ?? 0;
  const noCacheTokens = usage?.inputTokenDetails?.noCacheTokens;
  const cacheWriteTokens = usage?.inputTokenDetails?.cacheWriteTokens;

  if (noCacheTokens !== undefined || cacheWriteTokens !== undefined) {
    return (noCacheTokens ?? 0) + (cacheWriteTokens ?? 0);
  }

  return Math.max(0, inputTokens - getUsageCacheReadTokens(usage));
};

export type ContextProps = ComponentProps<typeof Popover> & ContextSchema;

export const Context = ({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  ...props
}: ContextProps) => {
  const contextValue = useMemo(
    () => ({ maxTokens, modelId, usage, usedTokens }),
    [maxTokens, modelId, usage, usedTokens],
  );

  return (
    <ContextContext.Provider value={contextValue}>
      <Popover {...props} />
    </ContextContext.Provider>
  );
};

const ContextIcon = () => {
  const aiT = useTranslations("aiElements");
  const { usedTokens, maxTokens } = useContextValue();
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const usedRatio = maxTokens > 0 ? clampRatio(usedTokens / maxTokens) : 0;
  const dashOffset = circumference * (1 - usedRatio);

  return (
    <svg
      aria-label={aiT("modelContextUsage")}
      height="20"
      role="img"
      style={{ color: "currentcolor" }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button>;

export const ContextTrigger = ({ children, ...props }: ContextTriggerProps) => {
  if (children) {
    return <PopoverTrigger render={children as ReactElement} />;
  }

  return (
    <PopoverTrigger render={<Button type="button" variant="ghost" {...props} />}>
      <ContextIcon />
    </PopoverTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof PopoverContent>;

export const ContextContent = ({
  className,
  ...props
}: ContextContentProps) => (
  <PopoverContent
    className={cn("min-w-60 divide-y overflow-hidden p-0", className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
  children,
  className,
  ...props
}: ContextContentHeaderProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { usedTokens, maxTokens, usage } = useContextValue();
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0;
  const usageLabel = usage ? aiT("exact") : aiT("estimated");
  const displayPct = format.number(usedPercent, {
    maximumFractionDigits: 1,
    style: "percent",
  });
  const used = format.number(usedTokens, { notation: "compact" });
  const total = format.number(maxTokens, { notation: "compact" });

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{aiT("context")}</span>
            <span className="font-medium text-muted-foreground">
              {usageLabel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="font-mono text-muted-foreground">
              {used} / {total}
            </p>
          </div>
          <div className="space-y-2">
            <Progress
              className="bg-muted [&_[data-slot=progress-indicator]]:bg-foreground"
              value={clampPercent(usedPercent * PERCENT_MAX)}
            />
          </div>
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
  children,
  className,
  ...props
}: ContextContentBodyProps) => (
  <div className={cn("w-full empty:hidden p-3", className)} {...props}>
    {children}
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  children,
  className,
  ...props
}: ContextContentFooterProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { modelId, usage } = useContextValue();
  const costUSD = modelId
    ? getUsage({
        modelId,
        usage: {
          cacheReads: getUsageCacheReadTokens(usage),
          input: getUsageBillableInputTokens(usage),
          output: usage?.outputTokens ?? 0,
        },
      }).costUSD?.totalUSD
    : undefined;
  const totalCost = format.number(costUSD ?? 0, {
    currency: "USD",
    style: "currency",
  });

  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-muted-foreground">{aiT("totalCost")}</span>
          <span>{totalCost}</span>
        </>
      )}
    </div>
  );
};

export type ContextInputUsageProps = ComponentProps<"div">;

export const ContextInputUsage = ({
  className,
  children,
  ...props
}: ContextInputUsageProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { usage, modelId } = useContextValue();
  const inputTokens = getUsageBillableInputTokens(usage);

  if (children) {
    return children;
  }

  if (!inputTokens) {
    return null;
  }

  const inputCost = modelId
    ? getUsage({
        modelId,
        usage: { input: inputTokens, output: 0 },
      }).costUSD?.totalUSD
    : undefined;
  const inputCostText = format.number(inputCost ?? 0, {
    currency: "USD",
    style: "currency",
  });

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">{aiT("input")}</span>
      <TokensWithCost costText={inputCostText} tokens={inputTokens} />
    </div>
  );
};

export type ContextOutputUsageProps = ComponentProps<"div">;

export const ContextOutputUsage = ({
  className,
  children,
  ...props
}: ContextOutputUsageProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { usage, modelId } = useContextValue();
  const outputTokens = usage?.outputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!outputTokens) {
    return null;
  }

  const outputCost = modelId
    ? getUsage({
        modelId,
        usage: { input: 0, output: outputTokens },
      }).costUSD?.totalUSD
    : undefined;
  const outputCostText = format.number(outputCost ?? 0, {
    currency: "USD",
    style: "currency",
  });

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">{aiT("output")}</span>
      <TokensWithCost costText={outputCostText} tokens={outputTokens} />
    </div>
  );
};

export type ContextReasoningUsageProps = ComponentProps<"div">;

export const ContextReasoningUsage = ({
  className,
  children,
  ...props
}: ContextReasoningUsageProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { usage, modelId } = useContextValue();
  const reasoningTokens = getUsageReasoningTokens(usage);

  if (children) {
    return children;
  }

  if (!reasoningTokens) {
    return null;
  }

  const reasoningCost = modelId
    ? getUsage({
        modelId,
        usage: { reasoningTokens },
      }).costUSD?.totalUSD
    : undefined;
  const reasoningCostText = format.number(reasoningCost ?? 0, {
    currency: "USD",
    style: "currency",
  });

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">{aiT("reasoning")}</span>
      <TokensWithCost costText={reasoningCostText} tokens={reasoningTokens} />
    </div>
  );
};

export type ContextCacheUsageProps = ComponentProps<"div">;

export const ContextCacheUsage = ({
  className,
  children,
  ...props
}: ContextCacheUsageProps) => {
  const aiT = useTranslations("aiElements");
  const format = useFormatter();
  const { usage, modelId } = useContextValue();
  const cacheTokens = getUsageCacheReadTokens(usage);

  if (children) {
    return children;
  }

  if (!cacheTokens) {
    return null;
  }

  const cacheCost = modelId
    ? getUsage({
        modelId,
        usage: { cacheReads: cacheTokens, input: 0, output: 0 },
      }).costUSD?.totalUSD
    : undefined;
  const cacheCostText = format.number(cacheCost ?? 0, {
    currency: "USD",
    style: "currency",
  });

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">{aiT("cache")}</span>
      <TokensWithCost costText={cacheCostText} tokens={cacheTokens} />
    </div>
  );
};

const TokensWithCost = ({
  tokens,
  costText,
}: {
  tokens?: number;
  costText?: string;
}) => {
  const format = useFormatter();
  return <span>
    {tokens === undefined
      ? "—"
      : format.number(tokens, { notation: "compact" })}
    {costText ? (
      <span className="ml-2 text-muted-foreground">• {costText}</span>
    ) : null}
  </span>;
};
