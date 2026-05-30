/**
 * Shared graph-DB open helper used by the CLI and the MCP stdio bin.
 *
 * Resolves the DB path from `CODESAGE_DB` (default `./.codesage/graph.db`),
 * ensures the parent dir exists, opens the connection and applies the schema.
 * The connection is long-lived; callers do NOT close it mid-process (Kuzu's
 * native close can deadlock with tree-sitter co-loaded) — the OS reclaims it on
 * process exit.
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { GraphConnection } from "./connection.js";
import { initSchema } from "./schema.js";

/** Resolve the graph DB path (env `CODESAGE_DB`, else `./.codesage/graph.db`). */
export function resolveDbPath(dbPath?: string): string {
  return resolve(dbPath ?? process.env.CODESAGE_DB ?? join(process.cwd(), ".codesage", "graph.db"));
}

/** Open (creating dirs) + schema-init a graph connection. */
export async function openGraph(dbPath?: string): Promise<GraphConnection> {
  const path = resolveDbPath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const conn = GraphConnection.open(path);
  await initSchema(conn);
  return conn;
}
