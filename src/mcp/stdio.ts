#!/usr/bin/env node
/**
 * EngramGraph MCP server — stdio entry (the `egr-mcp` bin a coding assistant
 * launches). Thin wrapper over {@link startMcpStdio}; also reachable via the
 * `egr mcp` CLI subcommand.
 *
 * Register with an assistant (example, Claude Code):
 *   claude mcp add egr -- node /path/to/engram/dist/mcp/stdio.js
 *
 * The graph DB path comes from `ENGRAM_DB` (default `./.engram/graph.db`).
 */

import { startMcpStdio } from "./serve-stdio.js";

startMcpStdio().catch((err) => {
  // stderr only — stdout is the MCP transport channel.
  process.stderr.write(`[egr-mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
