/**
 * Start the CodeSage MCP server over stdio. Shared by the `codesage-mcp` bin
 * (src/mcp/stdio.ts) and the `codesage mcp` CLI subcommand.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openGraph } from "../graph-db/open.js";
import { createMcpServer } from "./server.js";

export async function startMcpStdio(dbPath?: string): Promise<void> {
  const conn = await openGraph(dbPath);
  const server = createMcpServer(conn);
  await server.connect(new StdioServerTransport());
  // Stays alive on stdio; the connection is never closed (teardown caveat).
}
