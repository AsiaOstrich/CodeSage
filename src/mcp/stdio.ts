#!/usr/bin/env node
/**
 * CodeSage MCP server — stdio entry (the `codesage-mcp` bin a coding assistant
 * launches). Thin wrapper over {@link startMcpStdio}; also reachable via the
 * `codesage mcp` CLI subcommand.
 *
 * Register with an assistant (example, Claude Code):
 *   claude mcp add codesage -- node /path/to/codesage/dist/mcp/stdio.js
 *
 * The graph DB path comes from `CODESAGE_DB` (default `./.codesage/graph.db`).
 */

import { startMcpStdio } from "./serve-stdio.js";

startMcpStdio().catch((err) => {
  // stderr only — stdout is the MCP transport channel.
  process.stderr.write(`[codesage-mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
