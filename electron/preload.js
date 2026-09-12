import { contextBridge, ipcRenderer } from "electron";

const apiSessionToken = ipcRenderer.sendSync("api:get-session-token");
if (!apiSessionToken) {
  throw new Error("Missing API session token from Electron main process.");
}

const BASE_COLORS = new Set(["neutral", "slate", "gray", "zinc", "stone"]);
const ACCENT_COLORS = new Set([
  "black-white",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

const normalizeTheme = (theme) =>
  theme === "light" || theme === "dark" || theme === "system" ? theme : "dark";

const normalizeBaseColor = (baseColor) =>
  BASE_COLORS.has(baseColor) ? baseColor : "zinc";

const normalizeAccentColor = (accentColor) =>
  ACCENT_COLORS.has(accentColor) ? accentColor : "green";

const getSystemTheme = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

const getPreloadThemePreferences = () => {
  const prefix = "--dream-theme-preferences=";
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) {
    return null;
  }

  try {
    const raw = decodeURIComponent(argument.slice(prefix.length));
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getBrowserThemePreferences = () => {
  try {
    const rawUiPreferences = window.localStorage?.getItem(
      "dream-ui-preferences",
    );
    const uiPreferences = rawUiPreferences ? JSON.parse(rawUiPreferences) : {};

    return {
      accentColor: uiPreferences?.accentColor,
      baseColor: uiPreferences?.baseColor,
      theme: window.localStorage?.getItem("dream-theme"),
    };
  } catch {
    return null;
  }
};

const initialThemePreferences = (() => {
  const preferences =
    getPreloadThemePreferences() ?? getBrowserThemePreferences();
  return {
    accentColor: normalizeAccentColor(preferences?.accentColor),
    baseColor: normalizeBaseColor(preferences?.baseColor),
    theme: normalizeTheme(preferences?.theme),
  };
})();

const applyInitialThemePreferences = () => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (!root) {
    return;
  }

  const resolvedTheme =
    initialThemePreferences.theme === "system"
      ? getSystemTheme()
      : initialThemePreferences.theme;

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.classList.toggle("light", resolvedTheme === "light");
  root.style.colorScheme = resolvedTheme;

  if (initialThemePreferences.baseColor === "neutral") {
    root.removeAttribute("data-base-color");
  } else {
    root.setAttribute("data-base-color", initialThemePreferences.baseColor);
  }

  root.setAttribute("data-accent-color", initialThemePreferences.accentColor);
};

if (typeof document !== "undefined" && document.documentElement) {
  applyInitialThemePreferences();
} else {
  window.addEventListener("DOMContentLoaded", applyInitialThemePreferences, {
    once: true,
  });
}

const subscribe = (channel, listener) => {
  const subscription = (_event, payload) => {
    listener(payload);
  };

  ipcRenderer.on(channel, subscription);

  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
};

contextBridge.exposeInMainWorld("dream", {
  isElectron: true,
  apiSessionToken,
  initialThemePreferences,

  openExternal: (url) => ipcRenderer.invoke("shell:open-external", { url }),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", { path }),
  writeClipboardText: (text) =>
    ipcRenderer.invoke("clipboard:write-text", { text }),
  saveTextFile: (payload) => ipcRenderer.invoke("files:save-text", payload),

  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  pickProjectDirectory: () => ipcRenderer.invoke("projects:pick-directory"),

  loadState: () => ipcRenderer.invoke("state:load"),
  loadChatMessages: (chatId) =>
    ipcRenderer.invoke("state:load-chat-messages", { chatId }),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  saveChatMessages: (payload) =>
    ipcRenderer.invoke("state:save-chat-messages", payload),
  saveActiveProject: (payload) =>
    ipcRenderer.invoke("state:save-active-project", payload),
  getThemePreferences: () => ipcRenderer.invoke("theme:get-preferences"),
  setThemePreference: (theme) => ipcRenderer.invoke("theme:set", { theme }),
  setBaseColor: (baseColor) =>
    ipcRenderer.invoke("theme:set-base-color", { baseColor }),
  setAccentColor: (accentColor) =>
    ipcRenderer.invoke("theme:set-accent-color", { accentColor }),

  detectTerminalShells: () => ipcRenderer.invoke("terminal:detect-shells"),
  startTerminal: (payload) => ipcRenderer.invoke("terminal:start", payload),
  sendTerminalInput: (payload) => ipcRenderer.send("terminal:input", payload),
  acknowledgeTerminalOutput: (payload) =>
    ipcRenderer.send("terminal:acknowledge", payload),
  getTerminalOutputDiagnostics: () =>
    ipcRenderer.invoke("terminal:diagnostics"),
  resizeTerminal: (payload) => ipcRenderer.send("terminal:resize", payload),
  stopTerminal: (projectId) =>
    ipcRenderer.invoke("terminal:stop", { projectId }),
  stopAllTerminals: () => ipcRenderer.invoke("terminal:stop-all"),
  onTerminalData: (listener) => subscribe("terminal:data", listener),
  onTerminalStatus: (listener) => subscribe("terminal:status", listener),

  updateBrowser: (payload) => ipcRenderer.send("browser:update", payload),
  onBrowserError: (listener) => subscribe("browser:error", listener),
  onBrowserPageState: (listener) => subscribe("browser:page-state", listener),
  onBrowserStatus: (listener) => subscribe("browser:status", listener),

  detectEditors: () => ipcRenderer.invoke("editors:detect"),
  openInEditor: (payload) => ipcRenderer.invoke("editors:open", payload),

  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (listener) => subscribe("updates:status", listener),
});
