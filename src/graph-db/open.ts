/**
 * Shared graph-DB open helper used by the CLI and the MCP stdio bin.
 *
 * Resolves the DB path, ensures the parent dir exists, opens the connection and
 * applies the schema. The connection is long-lived; callers do NOT close it
 * mid-process (Kuzu's native close can deadlock with tree-sitter co-loaded) —
 * the OS reclaims it on process exit.
 *
 * Path resolution priority (XSPEC-245):
 *   1. explicit `dbPath` (programmatic; caller knows best)
 *   2. env `CODESAGE_DB` (highest user-facing knob — a full path)
 *   3. `graph` name → `<cwd>/.codesage/<name>.db`
 *   4. git-branch isolation (opt-in via `isolation: "git-branch"` or env
 *      `CODESAGE_ISOLATION=git-branch`) → `<git-common-dir>/codesage/<branch>.db`
 *      (falls back to #5 when not a git repo / detached HEAD)
 *   5. single default → `<cwd>/.codesage/graph.db`
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { GraphConnection } from "./connection.js";
import { initSchema } from "./schema.js";
import { gitBranchDbPath } from "./git-branch.js";

export type IsolationMode = "single" | "git-branch";

export interface GraphLocationOptions {
  /** Explicit DB path (wins over everything). */
  dbPath?: string;
  /** Explicit graph name → `<cwd>/.codesage/<name>.db`. */
  graph?: string;
  /** Isolation mode; defaults to env `CODESAGE_ISOLATION` else `"single"`. */
  isolation?: IsolationMode;
  /** Working dir for git detection / relative paths (default `process.cwd()`). */
  cwd?: string;
}

/** Sanitize a user-supplied graph name to a safe single path segment. */
function sanitizeGraphName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "graph";
}

/** Resolve the graph DB path per the XSPEC-245 priority order. */
export function resolveDbPath(loc: string | GraphLocationOptions = {}): string {
  const o: GraphLocationOptions = typeof loc === "string" ? { dbPath: loc } : loc;
  const cwd = o.cwd ?? process.cwd();

  // 1. explicit programmatic path
  if (o.dbPath) return resolve(o.dbPath);
  // 2. env CODESAGE_DB
  if (process.env.CODESAGE_DB) return resolve(process.env.CODESAGE_DB);
  // 3. explicit graph name
  if (o.graph) return resolve(join(cwd, ".codesage", `${sanitizeGraphName(o.graph)}.db`));
  // 4. git-branch isolation (opt-in)
  const mode: IsolationMode =
    o.isolation ?? (process.env.CODESAGE_ISOLATION === "git-branch" ? "git-branch" : "single");
  if (mode === "git-branch") {
    const branchPath = gitBranchDbPath(cwd);
    if (branchPath) return branchPath; // else fall through to single default
  }
  // 5. single default
  return resolve(join(cwd, ".codesage", "graph.db"));
}

/** Open (creating dirs) + schema-init a graph connection. */
export async function openGraph(loc?: string | GraphLocationOptions): Promise<GraphConnection> {
  const path = resolveDbPath(loc ?? {});
  mkdirSync(dirname(path), { recursive: true });
  const conn = GraphConnection.open(path);
  await initSchema(conn);
  return conn;
}
