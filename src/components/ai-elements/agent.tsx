import type { Tool } from "ai";
import { BotIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { memo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { CodeBlock } from "./code-block";

export type AgentProps = ComponentProps<"div">;

export const Agent = memo(({ className, ...props }: AgentProps) => (
  <div
    className={cn("not-prose w-full rounded-md border", className)}
    {...props}
  />
));

export type AgentHeaderProps = ComponentProps<"div"> & {
  name: string;
  model?: string;
};

export const AgentHeader = memo(
  ({ className, name, model, ...props }: AgentHeaderProps) => (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{name}</span>
        {model && (
          <Badge className="font-mono text-xs" variant="secondary">
            {model}
          </Badge>
        )}
      </div>
    </div>
  ),
);

export type AgentContentProps = ComponentProps<"div">;

export const AgentContent = memo(
  ({ className, ...props }: AgentContentProps) => (
    <div className={cn("space-y-4 p-4 pt-0", className)} {...props} />
  ),
);

export type AgentInstructionsProps = ComponentProps<"div"> & {
  children: string;
};

export const AgentInstructions = memo(
  ({ className, children, ...props }: AgentInstructionsProps) => {
    const aiT = useTranslations("aiElements");
    return (
    <div className={cn("space-y-2", className)} {...props}>
      <span className="font-medium text-muted-foreground text-sm">
        {aiT("instructions")}
      </span>
      <div className="rounded-md bg-surface-50 dark:bg-surface-900 p-3 text-muted-foreground text-sm">
        <p>{children}</p>
      </div>
    </div>
    );
  },
);

export type AgentToolsProps = ComponentProps<typeof Accordion>;

export const AgentTools = memo(({ className, ...props }: AgentToolsProps) => {
  const aiT = useTranslations("aiElements");
  return <div className={cn("space-y-2", className)}>
    <span className="font-medium text-muted-foreground text-sm">
      {aiT("tools")}
    </span>
    <Accordion className="rounded-md border" {...props} />
  </div>;
});

export type AgentToolProps = ComponentProps<typeof AccordionItem> & {
  tool: Tool;
};

export const AgentTool = memo(
  ({ className, tool, value, ...props }: AgentToolProps) => {
    const aiT = useTranslations("aiElements");
    const schema =
      "jsonSchema" in tool && tool.jsonSchema
        ? tool.jsonSchema
        : tool.inputSchema;

    return (
      <AccordionItem
        className={cn("border-b last:border-b-0", className)}
        value={value}
        {...props}
      >
        <AccordionTrigger className="px-3 py-2 text-sm hover:no-underline">
          {typeof tool.description === "string"
            ? tool.description
            : aiT("noDescription")}
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3">
          <div className="rounded-md bg-surface-50 dark:bg-surface-900">
            <CodeBlock code={JSON.stringify(schema, null, 2)} language="json" />
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  },
);

export type AgentOutputProps = ComponentProps<"div"> & {
  schema: string;
};

export const AgentOutput = memo(
  ({ className, schema, ...props }: AgentOutputProps) => {
    const aiT = useTranslations("aiElements");
    return (
    <div className={cn("space-y-2", className)} {...props}>
      <span className="font-medium text-muted-foreground text-sm">
        {aiT("outputSchema")}
      </span>
      <div className="rounded-md bg-surface-50 dark:bg-surface-900">
        <CodeBlock code={schema} language="typescript" />
      </div>
    </div>
    );
  },
);

Agent.displayName = "Agent";
AgentHeader.displayName = "AgentHeader";
AgentContent.displayName = "AgentContent";
AgentInstructions.displayName = "AgentInstructions";
AgentTools.displayName = "AgentTools";
AgentTool.displayName = "AgentTool";
AgentOutput.displayName = "AgentOutput";
