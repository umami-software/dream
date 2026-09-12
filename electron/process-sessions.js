import { spawn as spawnProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { app } from "electron";
import { spawn as spawnPty } from "node-pty";
import { stopChildProcess, stopProcessTree } from "./process-tree.js";
import { createTerminalOutput } from "./terminal-output.js";
import { getDefaultTerminalShellPath } from "./terminal-shells.js";

function parseCommandParts(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const parts = matches.map((part) =>
    part.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"),
  );
  const command = parts[0];
  if (!command) {
    return null;
  }

  return {
    args: parts.slice(1),
    command,
  };
}

function formatShellCommand(command, args = []) {
  const trimmedCommand = typeof command === "string" ? command.trim() : "";
  if (!trimmedCommand) {
    return "";
  }

  const normalizedArgs = Array.isArray(args)
    ? args
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  const formattedCommand = /\s/.test(trimmedCommand)
    ? `"${trimmedCommand.replaceAll('"', '\\"')}"`
    : trimmedCommand;
  return [formattedCommand, ...normalizedArgs].join(" ");
}

function createTerminalStartupCommands(command) {
  const commands = [];
  if (typeof command === "string" && command.trim()) {
    commands.push(command.trim());
  }

  return commands;
}

function resolveTerminalCwd(cwd, { strict = false } = {}) {
  if (typeof cwd !== "string") {
    if (strict) {
      throw new Error("Terminal working directory does not exist.");
    }
    return app.getPath("home");
  }

  const trimmed = cwd.trim();
  if (!trimmed) {
    if (strict) {
      throw new Error("Terminal working directory does not exist.");
    }
    return app.getPath("home");
  }

  try {
    if (existsSync(trimmed) && statSync(trimmed).isDirectory()) {
      return trimmed;
    }
  } catch {
    // ignore and fall back
  }

  if (strict) {
    throw new Error("Terminal working directory does not exist.");
  }

  return app.getPath("home");
}

function buildTerminalShellCandidates(preferredShellPath) {
  // Login shells often reset to $HOME, which breaks project-scoped terminals.
  const defaultShellArgs = process.platform === "win32" ? [] : ["-i"];
  const candidates = [];
  const seen = new Set();

  const addCandidate = (rawValue, label) => {
    const parsed = parseCommandParts(rawValue);
    if (!parsed) {
      return;
    }

    const args = parsed.args.length > 0 ? parsed.args : defaultShellArgs;
    const key = `${parsed.command}\u0000${args.join("\u0000")}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      args,
      command: parsed.command,
      label,
    });
  };

  addCandidate(preferredShellPath, "configured shell");
  if (process.platform === "win32") {
    addCandidate(getDefaultTerminalShellPath(), "PowerShell fallback");
    addCandidate(process.env.SHELL, "SHELL environment");
    addCandidate("cmd.exe", "CMD fallback");
  } else if (process.platform === "darwin") {
    addCandidate(process.env.SHELL, "SHELL environment");
    addCandidate("/bin/zsh", "macOS zsh fallback");
    addCandidate("/bin/bash", "bash fallback");
    addCandidate("/bin/sh", "sh fallback");
  } else {
    addCandidate(process.env.SHELL, "SHELL environment");
    addCandidate("/bin/bash", "bash fallback");
    addCandidate("/bin/sh", "sh fallback");
  }

  return candidates;
}

function getPipeFallbackShell() {
  if (process.platform === "win32") {
    return {
      args: [],
      command: "powershell.exe",
      label: "PowerShell pipe fallback",
    };
  }

  if (existsSync("/bin/bash")) {
    return {
      args: ["--noprofile", "--norc", "-i"],
      command: "/bin/bash",
      label: "bash pipe fallback",
    };
  }

  return {
    args: ["-i"],
    command: "/bin/sh",
    label: "sh pipe fallback",
  };
}

export function createProcessSessionManager({ sendToRenderer }) {
  const runProcesses = new Map();
  const terminalSessions = new Map();
  const terminalTransports = new Map();
  const terminalShells = new Map();
  const terminalOutputs = new Map();
  const terminalStartupTimers = new Map();

  function clearTerminalStartupTimer(projectId) {
    clearTimeout(terminalStartupTimers.get(projectId));
    terminalStartupTimers.delete(projectId);
  }

  function writeTerminalStartupCommands(projectId, commands, delayMs = 80) {
    if (!Array.isArray(commands) || commands.length === 0) {
      return;
    }

    clearTerminalStartupTimer(projectId);
    const session = terminalSessions.get(projectId);
    const timer = setTimeout(() => {
      if (terminalStartupTimers.get(projectId) === timer) {
        terminalStartupTimers.delete(projectId);
      }
      if (!session || terminalSessions.get(projectId) !== session) {
        return;
      }

      try {
        session.write(`${commands.join("\r")}\r`);
      } catch {
        // ignore write failures after session exits
      }
    }, delayMs);
    terminalStartupTimers.set(projectId, timer);
  }

  async function stopRunProcess(projectId) {
    const child = runProcesses.get(projectId);
    if (!child) {
      return;
    }

    runProcesses.delete(projectId);
    await stopChildProcess(child);
    sendToRenderer("runner:status", {
      projectId,
      status: "stopped",
    });
  }

  async function stopTerminalSession(projectId) {
    clearTerminalStartupTimer(projectId);
    const session = terminalSessions.get(projectId);
    const transport = terminalTransports.get(projectId);
    const shell = terminalShells.get(projectId);
    if (!session) {
      return;
    }

    terminalOutputs.get(projectId)?.dispose();
    terminalOutputs.delete(projectId);
    terminalSessions.delete(projectId);
    terminalTransports.delete(projectId);
    terminalShells.delete(projectId);

    await stopProcessTree(session.pid);
    try {
      await Promise.resolve(session.kill());
    } catch {
      // ignore stop failures
    }

    sendToRenderer("terminal:status", {
      projectId,
      shell,
      status: "stopped",
      transport,
    });
  }

  function hasActiveSessions() {
    return runProcesses.size > 0 || terminalSessions.size > 0;
  }

  async function stopAllProcesses() {
    await Promise.all([
      ...[...runProcesses.keys()].map((projectId) => stopRunProcess(projectId)),
      ...[...terminalSessions.keys()].map((projectId) =>
        stopTerminalSession(projectId),
      ),
    ]);
  }

  async function startRunner({ command, cwd, projectId, projectName }) {
    if (!projectId || !cwd || !command) {
      throw new Error("Missing runner parameters.");
    }

    await stopRunProcess(projectId);

    const child = spawnProcess(command, {
      cwd,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        FORCE_COLOR: "1",
      },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    runProcesses.set(projectId, child);

    sendToRenderer("runner:status", {
      pid: child.pid,
      projectId,
      projectName,
      status: "running",
    });

    child.stdout?.on("data", (chunk) => {
      sendToRenderer("runner:data", {
        chunk: chunk.toString(),
        projectId,
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (chunk) => {
      sendToRenderer("runner:data", {
        chunk: chunk.toString(),
        projectId,
        stream: "stderr",
      });
    });

    child.on("close", (code, signal) => {
      if (runProcesses.get(projectId) === child) {
        runProcesses.delete(projectId);
      }
      sendToRenderer("runner:status", {
        code,
        projectId,
        signal,
        status: "stopped",
      });
    });

    child.on("error", (error) => {
      sendToRenderer("runner:data", {
        chunk: `[runner error] ${error.message}\n`,
        projectId,
        stream: "stderr",
      });
    });

    return { pid: child.pid, status: "running" };
  }

  async function startTerminal({
    command,
    cwd,
    projectId,
    shellPath,
    strictCwd,
  }) {
    if (!projectId || !cwd) {
      throw new Error("Missing terminal parameters.");
    }

    await stopTerminalSession(projectId);

    const shellCandidates = buildTerminalShellCandidates(shellPath);
    const resolvedCwd = resolveTerminalCwd(cwd, { strict: strictCwd === true });

    let terminalSession;
    let chosenShell = null;
    const spawnErrors = [];

    for (const candidate of shellCandidates) {
      try {
        terminalSession = spawnPty(candidate.command, candidate.args, {
          cols: 120,
          cwd: resolvedCwd,
          env: {
            ...process.env,
            PROMPT_EOL_MARK: "",
            TERM: "xterm-256color",
          },
          name: "xterm-256color",
          rows: 36,
        });
        chosenShell = candidate;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spawnErrors.push(
          `${candidate.command} (${candidate.label}): ${message}`,
        );
      }
    }

    if (!terminalSession || !chosenShell) {
      const pipeFallbackCandidate = getPipeFallbackShell();

      let child;
      try {
        child = spawnProcess(
          pipeFallbackCandidate.command,
          pipeFallbackCandidate.args,
          {
            cwd: resolvedCwd,
            detached: process.platform !== "win32",
            env: {
              ...process.env,
              BASH_SILENCE_DEPRECATION_WARNING: "1",
              PROMPT_EOL_MARK: "",
              PS1: "\\u@\\h \\W $ ",
              TERM: "xterm-256color",
            },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spawnErrors.push(
          `${pipeFallbackCandidate.command} (${pipeFallbackCandidate.label}): ${message}`,
        );
        const detail =
          spawnErrors.length > 0 ? `\r\n${spawnErrors.join("\r\n")}` : "";
        sendToRenderer("terminal:data", {
          chunk: `\r\n[terminal error] Unable to start shell.${detail}\r\n`,
          projectId,
        });
        sendToRenderer("terminal:status", {
          projectId,
          status: "stopped",
        });
        return { status: "stopped" };
      }

      if (typeof child.pid !== "number") {
        const detail =
          spawnErrors.length > 0 ? `\r\n${spawnErrors.join("\r\n")}` : "";
        sendToRenderer("terminal:data", {
          chunk: `\r\n[terminal error] Shell started without a PID.${detail}\r\n`,
          projectId,
        });
        sendToRenderer("terminal:status", {
          projectId,
          status: "stopped",
        });
        return { status: "stopped" };
      }

      const output = createTerminalOutput({
        projectId,
        send: sendToRenderer,
        pause: () => {
          child.stdout?.pause();
          child.stderr?.pause();
        },
        resume: () => {
          child.stdout?.resume();
          child.stderr?.resume();
        },
      });
      terminalOutputs.set(projectId, output);
      terminalSessions.set(projectId, {
        kill: () => {
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore stop failures after the process tree exits
          }
        },
        pid: child.pid,
        write: (data) => {
          if (
            typeof data !== "string" ||
            !child.stdin ||
            child.stdin.destroyed ||
            child.stdin.writableEnded
          ) {
            return;
          }

          child.stdin.write(data);
        },
      });
      terminalTransports.set(projectId, "pipe");
      const shellCommand = formatShellCommand(
        pipeFallbackCandidate.command,
        pipeFallbackCandidate.args,
      );
      terminalShells.set(projectId, shellCommand);

      sendToRenderer("terminal:status", {
        pid: child.pid,
        projectId,
        shell: shellCommand,
        status: "running",
        transport: "pipe",
      });

      if (spawnErrors.length > 0) {
        sendToRenderer("terminal:data", {
          chunk: `\u001b[2m[terminal info] PTY unavailable; using pipe fallback.\u001b[0m\r\n`,
          projectId,
        });
      }

      child.stdout?.on("data", (chunk) => {
        output.write(chunk.toString());
      });

      child.stderr?.on("data", (chunk) => {
        output.write(chunk.toString());
      });

      child.on("close", (code, signal) => {
        if (terminalOutputs.get(projectId) !== output) return;
        clearTerminalStartupTimer(projectId);
        output.flush();
        output.dispose();
        terminalOutputs.delete(projectId);
        terminalSessions.delete(projectId);
        terminalTransports.delete(projectId);
        terminalShells.delete(projectId);
        sendToRenderer("terminal:status", {
          code,
          projectId,
          shell: shellCommand,
          signal,
          status: "stopped",
          transport: "pipe",
        });
      });

      child.on("error", (error) => {
        if (terminalOutputs.get(projectId) !== output) return;
        clearTerminalStartupTimer(projectId);
        output.flush();
        output.dispose();
        terminalOutputs.delete(projectId);
        terminalSessions.delete(projectId);
        terminalTransports.delete(projectId);
        terminalShells.delete(projectId);
        sendToRenderer("terminal:data", {
          chunk: `\r\n[terminal error] ${error.message}\r\n`,
          projectId,
        });
        sendToRenderer("terminal:status", {
          projectId,
          shell: shellCommand,
          status: "stopped",
          transport: "pipe",
        });
      });

      writeTerminalStartupCommands(
        projectId,
        createTerminalStartupCommands(command),
      );

      return {
        pid: child.pid,
        shell: shellCommand,
        status: "running",
        transport: "pipe",
      };
    }

    terminalSessions.set(projectId, terminalSession);
    terminalTransports.set(projectId, "pty");
    const shellCommand = formatShellCommand(
      chosenShell.command,
      chosenShell.args,
    );
    terminalShells.set(projectId, shellCommand);
    sendToRenderer("terminal:status", {
      pid: terminalSession.pid,
      projectId,
      shell: shellCommand,
      status: "running",
      transport: "pty",
    });

    const output = createTerminalOutput({
      projectId,
      send: sendToRenderer,
      pause: () => terminalSession.pause(),
      resume: () => terminalSession.resume(),
    });
    terminalOutputs.set(projectId, output);
    terminalSession.onData((chunk) => output.write(chunk));

    terminalSession.onExit(({ exitCode, signal }) => {
      if (terminalOutputs.get(projectId) !== output) return;
      clearTerminalStartupTimer(projectId);
      output.flush();
      output.dispose();
      terminalOutputs.delete(projectId);
      terminalSessions.delete(projectId);
      terminalTransports.delete(projectId);
      terminalShells.delete(projectId);
      sendToRenderer("terminal:status", {
        code: exitCode,
        projectId,
        shell: shellCommand,
        signal: signal ?? null,
        status: "stopped",
        transport: "pty",
      });
    });

    writeTerminalStartupCommands(
      projectId,
      createTerminalStartupCommands(command),
    );

    return {
      pid: terminalSession.pid,
      shell: shellCommand,
      status: "running",
      transport: "pty",
    };
  }

  function writeTerminalInput({ data, projectId }) {
    if (!projectId || typeof data !== "string") {
      return;
    }

    const session = terminalSessions.get(projectId);
    if (!session) {
      return;
    }

    try {
      session.write(data);
    } catch {
      // ignore write failures after process/session exits
    }
  }

  function resizeTerminal({ cols, projectId, rows }) {
    if (!projectId) {
      return;
    }

    const session = terminalSessions.get(projectId);
    if (!session || typeof session.resize !== "function") {
      return;
    }

    const normalizedCols = Math.floor(Number(cols));
    const normalizedRows = Math.floor(Number(rows));

    if (
      !Number.isFinite(normalizedCols) ||
      !Number.isFinite(normalizedRows) ||
      normalizedCols < 2 ||
      normalizedRows < 1
    ) {
      return;
    }

    try {
      session.resize(normalizedCols, normalizedRows);
    } catch {
      // ignore resize failures after session exits
    }
  }

  return {
    acknowledgeTerminalOutput: (event) => {
      if (event && typeof event.projectId === "string") {
        terminalOutputs.get(event.projectId)?.acknowledge(event);
      }
    },
    getTerminalOutputDiagnostics: () =>
      [...terminalOutputs.values()].map((output) => output.getDiagnostics()),
    hasActiveSessions,
    resizeTerminal,
    startRunner,
    startTerminal,
    stopAllProcesses,
    stopRunProcess,
    stopTerminalSession,
    writeTerminalInput,
  };
}
