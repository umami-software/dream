import { Search, X } from "lucide-react";
import { type ComponentProps, useRef } from "react";
import { cn } from "@/lib/utils";

type SearchInputProps = Omit<
  ComponentProps<"input">,
  "defaultValue" | "onChange" | "type" | "value" | "ref"
> & {
  clearLabel: string;
  onClear?: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

export function SearchInput({
  className,
  clearLabel,
  disabled,
  onClear,
  onKeyDown,
  onValueChange,
  readOnly,
  value,
  ...props
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    if (onClear) {
      onClear();
    } else {
      onValueChange("");
    }
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
      />
      <input
        aria-label={props.placeholder}
        spellCheck={false}
        {...props}
        className="h-8 w-full min-w-0 rounded-lg border border-surface-200 bg-surface-50 py-1 pr-8 pl-[34px] text-foreground text-sm outline-none placeholder:text-muted-foreground focus-visible:border-input disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-800 dark:bg-surface-900"
        disabled={disabled}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing &&
            !disabled &&
            !readOnly
          ) {
            event.preventDefault();
            clear();
          }
        }}
        readOnly={readOnly}
        ref={inputRef}
        type="text"
        value={value}
      />
      {value && !readOnly ? (
        <button
          aria-label={clearLabel}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={clear}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
