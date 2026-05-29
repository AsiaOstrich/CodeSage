import { Hono } from "hono";

import { healthRoute } from "./routes/health.js";

/**
 * Build the CodeSage Hono application.
 *
 * Phase 1 mounts only the health route (AC-1). Later phases add
 * `/graph/query`, `/graph/impact-analysis`, `/graph/ingest`.
 */
export function createServer(): Hono {
  const app = new Hono();

  app.route("/", healthRoute());

  return app;
}
