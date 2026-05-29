import { createServer as createHttpServer } from "node:http";
import { Readable } from "node:stream";

import { createServer } from "./server.js";

/**
 * Minimal Node http <-> Hono bridge for local development (`npm run dev`).
 *
 * Avoids an extra `@hono/node-server` dependency by adapting the Web Fetch
 * `app.fetch` handler onto a built-in `http` server. Not intended for
 * production serving.
 */
const app = createServer();
const port = Number(process.env.PORT ?? 3000);

const server = createHttpServer(async (req, res) => {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
  };
  if (hasBody) {
    // Node's fetch requires `duplex: "half"` for streamed request bodies.
    init.duplex = "half";
  }
  const request = new Request(url, init);

  const response = await app.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.end(text);
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`CodeSage dev server listening on http://localhost:${port}`);
});
