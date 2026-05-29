import { describe, it, expect } from "vitest";

import { createServer } from "../src/api/server.js";

/**
 * AC-1: `GET /health` returns HTTP 200 with `{ status: "ok" }` after a live
 * Kuzu init + schema check.
 */
describe("health route (AC-1)", () => {
  it("returns 200 { status: 'ok' }", async () => {
    const app = createServer();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
