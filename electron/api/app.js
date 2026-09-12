/**
 * Hono-based API server for Dream IDE.
 *
 * Migrated from Next.js App Router route handlers.  Each route keeps the same
 * Request/Response contract so the renderer `fetch("/api/…")` calls work
 * unchanged.
 *
 * This file is loaded by the Electron main process at startup.
 */

import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { registerChatRoutes } from "./chat-routes.js";
import { registerCheckpointRoutes } from "./checkpoint-routes.js";
import { registerProjectGitRoutes } from "./project-git-routes.js";
import { registerProviderRoutes } from "./provider-routes.js";
import { registerToolApprovalRoutes } from "./tool-approvals.js";

export const API_SESSION_TOKEN_HEADER = "x-dream-api-token";

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

export function createApiSessionToken() {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Exported start function
// ---------------------------------------------------------------------------

function createApiApp(apiToken) {
  if (!apiToken) {
    throw new Error("API session token is required to start the API server.");
  }

  const guardedApp = new Hono();

  guardedApp.use("/api/*", async (c, next) => {
    if (c.req.header(API_SESSION_TOKEN_HEADER) !== apiToken) {
      return c.text("Unauthorized", 401);
    }

    await next();
  });

  registerToolApprovalRoutes(guardedApp);
  registerProviderRoutes(guardedApp);
  registerChatRoutes(guardedApp);
  registerProjectGitRoutes(guardedApp);
  registerCheckpointRoutes(guardedApp);

  return guardedApp;
}

export function startApiServer({ port, apiToken }) {
  const guardedApp = createApiApp(apiToken);

  return new Promise((resolve) => {
    serve(
      {
        fetch: guardedApp.fetch,
        hostname: "127.0.0.1",
        port,
      },
      (info) => {
        console.log(`API server listening on http://127.0.0.1:${info.port}`);
        resolve(info.port);
      },
    );
  });
}
