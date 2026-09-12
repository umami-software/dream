import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { type HTMLAttributes, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { getDesktopApi } from "@/lib/electron";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { echoPipeFallbackInput } from "./ide-helpers";
import { useIdeStore } from "./ide-store";
import { TERMINAL_MIN_HEIGHT_PX } from "./ide-types";
import { RightPanelHeaderIconButton } from "./right-panel-header-icon-button";
import { StandardTabs } from "./standard-tabs";
import {
  getTerminalScrollback,
  subscribeToTerminalOutput,
} from "./terminal-scrollback";

const EMPTY_TERMINAL_SESSION_IDS: string[] = [];
const TERMINAL_SURFACE_CLASSES =
  "overflow-hidden rounded-lg border border-surface-300 dark:border-surface-700 bg-background text-foreground shadow-md";
const TERMINAL_HOST_CLASS = "h-full w-full overflow-hidden";
const TERMINAL_FONT_FAMILY_FALLBACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const DARK_TERMINAL_THEME = {
  background: "#0b0f14",
  foreground: "#d6deeb",
  cursor: "#f8fafc",
  cursorAccent: "#0b0f14",
  selectionBackground: "rgba(96, 165, 250, 0.28)",
  black: "#5c6773",
  red: "#ff6b6b",
  green: "#7ee787",
  yellow: "#f2cc60",
  blue: "#f59e0b",
  magenta: "#d2a8ff",
  cyan: "#39c5cf",
  white: "#d6deeb",
  brightBlack: "#8b949e",
  brightRed: "#ff8787",
  brightGreen: "#a7f3d0",
  brightYellow: "#ffe08a",
  brightBlue: "#fbbf24",
  brightMagenta: "#e5c7ff",
  brightCyan: "#7dd3fc",
  brightWhite: "#ffffff",
};

const LIGHT_TERMINAL_THEME = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#1f2328",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(37, 99, 235, 0.18)",
  black: "#24292f",
  red: "#b42318",
  green: "#116329",
  yellow: "#7a4f01",
  blue: "#9a3412",
  magenta: "#6639ba",
  cyan: "#0a6b76",
  white: "#57606a",
  brightBlack: "#57606a",
  brightRed: "#cf222e",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightBlue: "#c2410c",
  brightMagenta: "#8250df",
  brightCyan: "#087990",
  brightWhite: "#1f2328",
};

const stylePowerShellUpdateNotification = (value: string) => {
  const releaseUrlIndex = value.indexOf(
    "https://aka.ms/PowerShell-Release?tag=",
  );
  if (releaseUrlIndex < 0) {
    return value;
  }

  let bannerStart = value.lastIndexOf("\u001b[7m", releaseUrlIndex);
  if (bannerStart < 0) {
    return value;
  }

  for (let index = 0; index < 2; index += 1) {
    const previousReverse = value.lastIndexOf("\u001b[7m", bannerStart - 1);
    if (previousReverse < 0 || bannerStart - previousReverse > 300) {
      break;
    }
    bannerStart = previousReverse;
  }

  const afterReleaseUrl = value.slice(releaseUrlIndex);
  const nextAnsiSequenceIndex = afterReleaseUrl.indexOf("\u001b[");
  const bannerEnd =
    nextAnsiSequenceIndex < 0
      ? value.length
      : releaseUrlIndex + nextAnsiSequenceIndex;
  const styledBanner = value
    .slice(bannerStart, bannerEnd)
    .replaceAll("\u001b[7m", "\u001b[90m")
    .replaceAll("\u001b[27m", "\u001b[39m");

  return `${value.slice(0, bannerStart)}${styledBanner}\u001b[39m${value.slice(bannerEnd)}`;
};

const isCopyShortcut = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "c";

const formatTerminalShellLabel = (
  value: string | undefined,
  labels: { commandPrompt: string; systemShell: string },
) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return labels.systemShell;
  }

  const commandMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const command =
    commandMatch?.[1] ?? commandMatch?.[2] ?? commandMatch?.[3] ?? trimmed;
  const executable = command?.split(/[\\/]/).pop()?.toLowerCase();

  if (executable === "pwsh" || executable === "pwsh.exe") {
    return "PowerShell";
  }

  if (executable === "powershell" || executable === "powershell.exe") {
    return "PowerShell";
  }

  if (executable === "cmd" || executable === "cmd.exe") {
    return labels.commandPrompt;
  }

  if (executable === "bash" || executable === "bash.exe") {
    return /[\\/]git[\\/]/i.test(command) ? "Git Bash" : "bash";
  }

  if (executable === "zsh") {
    return "zsh";
  }

  if (executable === "sh") {
    return "sh";
  }

  if (executable === "wsl" || executable === "wsl.exe") {
    return "WSL";
  }

  return executable || trimmed;
};

const TerminalSurface = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => {
  const baseColor = useUiStore((s) => s.baseColor);

  return (
    <div
      className={cn(TERMINAL_SURFACE_CLASSES, className)}
      data-base-color={baseColor === "neutral" ? undefined : baseColor}
      {...props}
    />
  );
};

const resolveCssCustomProperty = (
  style: CSSStyleDeclaration,
  name: string,
  seen = new Set<string>(),
): string => {
  if (seen.has(name)) {
    return "";
  }

  seen.add(name);

  const value = style.getPropertyValue(name).trim();
  const variableMatch = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);

  if (!variableMatch) {
    return value;
  }

  const [, variableName, fallback] = variableMatch;
  return (
    resolveCssCustomProperty(style, variableName, seen) ||
    fallback?.trim() ||
    ""
  );
};

const isTransparentColor = (value: string) =>
  value === "transparent" || value === "rgba(0, 0, 0, 0)";

const resolveTerminalTheme = (host: HTMLElement, resolvedTheme?: string) => {
  const isDark = resolvedTheme === "dark";
  const theme = isDark ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
  const style = getComputedStyle(host);
  const background =
    resolveCssCustomProperty(style, "--background") || style.backgroundColor;

  if (!background || isTransparentColor(background)) {
    return theme;
  }

  return {
    ...theme,
    background,
    cursorAccent: background,
  };
};

const resolveTerminalFontFamily = (host: HTMLElement) => {
  const style = getComputedStyle(host);
  return (
    resolveCssCustomProperty(style, "--font-mono") ||
    resolveCssCustomProperty(style, "--font-jetbrains-mono") ||
    TERMINAL_FONT_FAMILY_FALLBACK
  );
};

export interface TerminalPanelProps {
  projectId: string;
  sessionId: string;
  title?: string;
  subtitle?: string;
  autoStart?: boolean;
  bordered?: boolean;
  isActive?: boolean;
  showHeader?: boolean;
  onClose: () => void;
  onStart?: () => Promise<void> | void;
  onStop?: () => Promise<void> | void;
  stopOnClose?: boolean;
}

export const TerminalPanel = ({
  projectId,
  sessionId,
  title,
  subtitle,
  autoStart = false,
  bordered = true,
  isActive = true,
  showHeader = true,
  onClose,
  onStart,
  onStop,
  stopOnClose = true,
}: TerminalPanelProps) => {
  const commonT = useTranslations("common");
  const terminalT = useTranslations("terminal");
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const transportRef = useRef(
    useIdeStore.getState().terminalTransport[sessionId] ?? "pty",
  );
  const statusRef = useRef(
    useIdeStore.getState().terminalStatus[sessionId] ?? "stopped",
  );
  const terminalShell = useIdeStore((s) => s.terminalShell[sessionId]);
  const terminalStatus = useIdeStore(
    (s) => s.terminalStatus[sessionId] ?? "stopped",
  );
  const terminalTransport = useIdeStore(
    (s) => s.terminalTransport[sessionId] ?? "pty",
  );
  const terminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const fitTerminalRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    transportRef.current = terminalTransport;

    const terminal = terminalInstanceRef.current;
    if (terminal) {
      terminal.options.convertEol = terminalTransport === "pipe";
    }
  }, [terminalTransport]);

  useEffect(() => {
    statusRef.current = terminalStatus;
  }, [terminalStatus]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: transportRef.current === "pipe",
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: resolveTerminalFontFamily(host),
      fontSize: 12,
      minimumContrastRatio: 4.5,
      theme: resolveTerminalTheme(host, themeRef.current),
    });
    terminalInstanceRef.current = terminal;

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      const state = useIdeStore.getState();

      if (event.ctrlKey || event.metaKey) {
        state.openExternalUrl(uri);
        return;
      }

      state.createBrowserTab(projectId, uri);
      state.updateProject(projectId, (project) => ({
        ...project,
        browserUrl: uri,
      }));
      state.setProjectTerminalPanelOpen(projectId, false);
      state.setProjectRightPanelView(projectId, "browser");
      state.setProjectRightPanelOpen(projectId, true);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !isCopyShortcut(event)) {
        return true;
      }

      const selection = terminal.getSelection();
      if (!selection) {
        return true;
      }

      event.preventDefault();
      event.stopPropagation();
      void navigator.clipboard.writeText(selection);
      return false;
    });
    terminal.open(host);

    let resizeFrame: number | null = null;

    const fitAndSyncSize = () => {
      resizeFrame = null;
      // Hidden tabs retain their last valid size and continue parsing output.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fitAddon.fit();

      const cols = terminal.cols;
      const rows = terminal.rows;

      if (cols < 2 || rows < 1) {
        return;
      }

      const previousSize = terminalSizeRef.current;
      if (previousSize?.cols === cols && previousSize.rows === rows) {
        return;
      }

      terminalSizeRef.current = { cols, rows };
      getDesktopApi()?.resizeTerminal({
        cols,
        projectId: sessionId,
        rows,
      });
    };

    const scheduleFitAndSyncSize = () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }

      resizeFrame = window.requestAnimationFrame(fitAndSyncSize);
    };

    fitTerminalRef.current = scheduleFitAndSyncSize;
    terminalSizeRef.current = null;
    fitAndSyncSize();

    const initialOutput = getTerminalScrollback(sessionId);
    if (initialOutput) {
      terminal.write(stylePowerShellUpdateNotification(initialOutput));
    }

    if (autoStart && statusRef.current !== "running") {
      void onStart?.();
    }

    const removeTerminalData = subscribeToTerminalOutput(
      sessionId,
      (chunk, processed) => {
        terminal.write(stylePowerShellUpdateNotification(chunk), processed);
      },
    );

    const inputSubscription = terminal.onData((data) => {
      const api = getDesktopApi();
      if (!api) {
        return;
      }

      if (transportRef.current === "pipe") {
        echoPipeFallbackInput(terminal, data);
      }

      api.sendTerminalInput({
        data,
        projectId: sessionId,
      });
    });

    const resizeObserver = new ResizeObserver(scheduleFitAndSyncSize);
    resizeObserver.observe(host);
    window.addEventListener("resize", scheduleFitAndSyncSize);

    return () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      removeTerminalData();
      inputSubscription.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleFitAndSyncSize);
      terminalInstanceRef.current = null;
      fitTerminalRef.current = null;
      terminal.dispose();
    };
  }, [autoStart, onStart, projectId, sessionId]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitTerminalRef.current?.();
      terminalInstanceRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isActive]);

  useEffect(() => {
    if (!resolvedTheme) {
      return;
    }

    const host = hostRef.current;
    const terminal = terminalInstanceRef.current;
    if (!host || !terminal) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      terminal.options.theme = resolveTerminalTheme(host, resolvedTheme);
      terminal.refresh(0, terminal.rows - 1);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [resolvedTheme]);

  const resolvedTitle = title ?? commonT("terminal");
  const shellLabel = formatTerminalShellLabel(subtitle ?? terminalShell, {
    commandPrompt: terminalT("commandPrompt"),
    systemShell: terminalT("systemShell"),
  });

  return (
    <div className={cn("flex h-full min-h-0 flex-col", bordered ? "pt-2" : "")}>
      {showHeader ? (
        <div className="min-h-0 flex-1 p-2">
          <TerminalSurface
            className="flex h-full min-h-0 flex-col"
            style={{ minHeight: TERMINAL_MIN_HEIGHT_PX }}
          >
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{resolvedTitle}</span>
                <span className="truncate text-muted-foreground">
                  {shellLabel}
                </span>
              </div>
              <Button
                aria-label={terminalT("closeNamedTerminal", {
                  name: resolvedTitle,
                })}
                className="h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onClose();
                  if (stopOnClose) {
                    void onStop?.();
                  }
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <div className={TERMINAL_HOST_CLASS} ref={hostRef} />
            </div>
          </TerminalSurface>
        </div>
      ) : null}
      {!showHeader ? (
        <div className="min-h-0 flex-1 p-2">
          <div className={TERMINAL_HOST_CLASS} ref={hostRef} />
        </div>
      ) : null}
    </div>
  );
};

export const ProjectTerminalTabsPanel = ({
  active = true,
  embedded = false,
  onClosePanel,
  projectId,
}: {
  active?: boolean;
  embedded?: boolean;
  onClosePanel?: () => void;
  projectId: string;
}) => {
  const terminalT = useTranslations("terminal");
  const projectTerminalSessionIds = useIdeStore(
    (s) => s.projectTerminalSessionIds,
  );
  const sessionIds =
    projectTerminalSessionIds[projectId] ?? EMPTY_TERMINAL_SESSION_IDS;
  const activeSessionId = useIdeStore(
    (s) => s.activeTerminalSessionIdByProject[projectId] ?? null,
  );
  const addProjectTerminal = useIdeStore((s) => s.addProjectTerminal);
  const closeProjectTerminal = useIdeStore((s) => s.closeProjectTerminal);
  const terminalSessionNames = useIdeStore((s) => s.terminalSessionNames);
  const setTerminalSessionName = useIdeStore((s) => s.setTerminalSessionName);
  const setActiveProjectTerminalId = useIdeStore(
    (s) => s.setActiveProjectTerminalId,
  );
  const reorderProjectTerminals = useIdeStore((s) => s.reorderProjectTerminals);

  const resolvedActiveSessionId =
    activeSessionId && sessionIds.includes(activeSessionId)
      ? activeSessionId
      : (sessionIds[0] ?? null);

  const resolveTerminalName = (sessionId: string, index: number) =>
    terminalSessionNames[sessionId]?.trim() ||
    terminalT("terminalNumber", { number: index + 1 });
  const terminalTabItems = sessionIds.map((sessionId, index) => ({
    id: sessionId,
    label: resolveTerminalName(sessionId, index),
  }));

  useEffect(() => {
    for (const [index, sessionId] of sessionIds.entries()) {
      if (terminalSessionNames[sessionId]?.trim()) {
        continue;
      }

      setTerminalSessionName(
        sessionId,
        terminalT("terminalNumber", { number: index + 1 }),
      );
    }
  }, [sessionIds, setTerminalSessionName, terminalSessionNames, terminalT]);

  if (!resolvedActiveSessionId) {
    return null;
  }

  const content = (
    <>
      <div className="flex items-center gap-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {onClosePanel ? (
            <RightPanelHeaderIconButton
              icon={TerminalSquare}
              onClose={onClosePanel}
            />
          ) : (
            <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
          )}
          <StandardTabs
            activeId={resolvedActiveSessionId}
            after={
              <Button
                aria-label={terminalT("openAnotherTerminal")}
                className="h-8 w-8 shrink-0 rounded-lg p-0 text-muted-foreground hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-foreground"
                onClick={() => void addProjectTerminal(projectId)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            }
            ariaLabel={terminalT("terminalTabs")}
            canClose={true}
            className="flex-1"
            closeAriaLabel={(tab) =>
              terminalT("closeNamedTerminal", { name: tab.label })
            }
            items={terminalTabItems}
            onActivate={(sessionId) =>
              setActiveProjectTerminalId(projectId, sessionId)
            }
            onClose={(sessionId) =>
              void closeProjectTerminal(projectId, sessionId)
            }
            onRename={(sessionId, label) =>
              setTerminalSessionName(sessionId, label)
            }
            onReorder={(fromIndex, toIndex) =>
              reorderProjectTerminals(projectId, fromIndex, toIndex)
            }
            renameOnDoubleClick={true}
          />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {sessionIds.map((sessionId, index) => {
          const isActive = sessionId === resolvedActiveSessionId;

          return (
            <div
              aria-hidden={!active || !isActive}
              className={cn(
                "absolute inset-0 min-h-0",
                active && isActive ? "block" : "hidden",
              )}
              inert={!active || !isActive}
              key={sessionId}
            >
              <TerminalPanel
                bordered={false}
                isActive={active && isActive}
                onClose={() => void closeProjectTerminal(projectId, sessionId)}
                projectId={projectId}
                sessionId={sessionId}
                showHeader={false}
                stopOnClose={false}
                title={resolveTerminalName(sessionId, index)}
              />
            </div>
          );
        })}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ minHeight: TERMINAL_MIN_HEIGHT_PX }}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col py-2 pr-2">
      <TerminalSurface
        className="flex min-h-0 flex-1 flex-col"
        style={{ minHeight: TERMINAL_MIN_HEIGHT_PX }}
      >
        {content}
      </TerminalSurface>
    </div>
  );
};
