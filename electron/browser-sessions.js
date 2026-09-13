import { writeFile } from "node:fs/promises";
import { dialog, webContents } from "electron";

function getSafeScreenshotName(value) {
  const base =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : "browser-screenshot";
  const sanitized = base
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return `${sanitized || "browser-screenshot"}.png`;
}

export function createBrowserSessionManager({ getMainWindow, sendToRenderer }) {
  function sendBrowserActionError(payload, code, description) {
    sendToRenderer("browser:error", {
      code,
      description,
      projectId: payload?.projectId,
      tabId: payload?.tabId,
    });
  }

  function getGuestWebContents(payload, actionName) {
    const webContentsId = Number(payload?.webContentsId);
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
      sendBrowserActionError(
        payload,
        "BROWSER_ACTION_FAILED",
        `No browser guest found for ${actionName}.`,
      );
      return null;
    }

    const guest = webContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed()) {
      sendBrowserActionError(
        payload,
        "BROWSER_ACTION_FAILED",
        `Browser guest is not ready for ${actionName}.`,
      );
      return null;
    }

    return guest;
  }

  async function clearBrowserCookies(payload) {
    const guest = getGuestWebContents(payload, "cookies");
    if (!guest) {
      return;
    }

    try {
      await guest.session.clearStorageData({
        storages: ["cookies"],
      });
    } catch {
      sendBrowserActionError(
        payload,
        "CLEAR_COOKIES_FAILED",
        "Failed to clear browser cookies.",
      );
    }
  }

  async function clearBrowserCache(payload) {
    const guest = getGuestWebContents(payload, "cache");
    if (!guest) {
      return;
    }

    try {
      await guest.session.clearCache();
    } catch {
      sendBrowserActionError(
        payload,
        "CLEAR_CACHE_FAILED",
        "Failed to clear browser cache.",
      );
    }
  }

  async function takeBrowserScreenshot(payload) {
    const guest = getGuestWebContents(payload, "screenshot");
    if (!guest) {
      return;
    }

    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      sendBrowserActionError(
        payload,
        "SCREENSHOT_FAILED",
        "No app window is available for saving the screenshot.",
      );
      return;
    }

    try {
      const image = await guest.capturePage();
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: getSafeScreenshotName(guest.getTitle()),
        filters: [{ name: "PNG image", extensions: ["png"] }],
        title: "Save browser screenshot",
      });

      if (result.canceled || !result.filePath) {
        return;
      }

      await writeFile(result.filePath, image.toPNG());
    } catch {
      sendBrowserActionError(
        payload,
        "SCREENSHOT_FAILED",
        "Failed to save browser screenshot.",
      );
    }
  }

  async function capturePage(payload) {
    const webContentsId = Number(payload?.webContentsId);
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
      return null;
    }

    const guest = webContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed()) {
      return null;
    }

    const rect = payload?.rect;
    const captureRect =
      rect &&
      [rect.x, rect.y, rect.width, rect.height].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) &&
      rect.width >= 1 &&
      rect.height >= 1
        ? {
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          }
        : undefined;

    try {
      const image = await guest.capturePage(captureRect);
      if (image.isEmpty()) {
        return null;
      }

      const { height, width } = image.getSize();
      return {
        dataUrl: image.toDataURL(),
        height,
        title: guest.getTitle(),
        url: guest.getURL(),
        width,
      };
    } catch {
      return null;
    }
  }

  function openBrowserDevTools(payload) {
    const guest = getGuestWebContents(payload, "DevTools");
    if (!guest) {
      return;
    }

    try {
      guest.openDevTools({ mode: "detach" });
    } catch {
      sendBrowserActionError(
        payload,
        "OPEN_DEVTOOLS_FAILED",
        "Failed to open browser DevTools.",
      );
    }
  }

  function update(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.openDevTools === true) {
      openBrowserDevTools(payload);
      return;
    }

    if (payload.takeScreenshot === true) {
      void takeBrowserScreenshot(payload);
      return;
    }

    if (payload.clearCookies === true) {
      void clearBrowserCookies(payload);
      return;
    }

    if (payload.clearCache === true) {
      void clearBrowserCache(payload);
    }
  }

  return {
    applyState: () => {},
    capturePage,
    hideForRendererNavigation: () => {},
    reset: () => {},
    update,
  };
}
