/**
 * CLI command logic — thin wrappers over the existing public API, kept
 * separate from arg parsing (src/cli/index.ts) so they are unit-testable.
 * Each function takes an open {@link GraphConnection} and returns plain data;
 * the entry point handles I/O, formatting and process lifecycle.
 */

import type { GraphConnection } from "../graph-db/connection.js";
import { indexProject, callers, callees, type CallNode } from "../code-graph/index.js";
import { indexKnowledgeDocs, impactAnalysis } from "../knowledge-graph/index.js";
import { applyFeedback, feedbackForEventType, topByConfidence, type ConfidenceLabel } from "../sage/index.js";
import { walkFiles } from "./walk.js";

const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] as const;

export interface IndexResultSummary {
  code: { files: number; functions: number; classes: number; calls: number; ambiguous: number; unresolved: number };
  knowledge?: { specs: number; decisions: number; impacts: number; supersedes: number };
}

/** `codesage index <dir> [--docs]` — index code (always) + knowledge docs (--docs). */
export async function cmdIndex(
  conn: GraphConnection,
  opts: { dir: string; docs?: boolean },
): Promise<IndexResultSummary> {
  const codeFiles = walkFiles(opts.dir, CODE_EXTS);
  const code = await indexProject(conn, codeFiles); // { files, functions, classes, calls, ambiguous, unresolved }
  const result: IndexResultSummary = { code };
  if (opts.docs) {
    const docs = walkFiles(opts.dir, [".md"]).map((f) => ({ content: f.source, fallbackId: f.path }));
    result.knowledge = await indexKnowledgeDocs(conn, docs);
  }
  return result;
}

/** `codesage callers <symbol> [--depth N]`. */
export function cmdCallers(conn: GraphConnection, symbol: string, depth = 1): Promise<CallNode[]> {
  return callers(conn, symbol, depth);
}

/** `codesage callees <symbol> [--depth N]`. */
export function cmdCallees(conn: GraphConnection, symbol: string, depth = 1): Promise<CallNode[]> {
  return callees(conn, symbol, depth);
}

/** `codesage impact <spec-id> [--max-hops N]`. */
export function cmdImpact(conn: GraphConnection, nodeId: string, maxHops = 3) {
  return impactAnalysis(conn, nodeId, maxHops);
}

/** `codesage feedback <type> <node-id> [--label L]`. */
export function cmdFeedback(
  conn: GraphConnection,
  type: string,
  nodeId: string,
  label: ConfidenceLabel = "Function",
  weight?: number,
) {
  const mapped = feedbackForEventType(type);
  return applyFeedback(
    conn,
    { nodeId, signal: mapped.signal, weight: weight ?? mapped.weight, source: "cli" },
    label,
  );
}

/** `codesage top <label> [--limit N]`. */
export function cmdTop(conn: GraphConnection, label: ConfidenceLabel, limit = 10) {
  return topByConfidence(conn, label, limit);
}
