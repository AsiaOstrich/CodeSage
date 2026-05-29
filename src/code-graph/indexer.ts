/**
 * CodeGraph indexer — write an extracted {@link GraphFragment} into Kuzu.
 *
 * Writes are idempotent (`MERGE` on node/edge id), so re-indexing a changed
 * file updates node properties in place rather than duplicating. Node/edge
 * labels come from the controlled {@link NodeLabel}/{@link RelLabel} unions, so
 * interpolating them into Cypher is safe; all value bindings use parameters.
 */

import type { GraphConnection } from "../graph-db/connection.js";
import type { GraphEdge, GraphFragment, GraphNode } from "../graph-db/types.js";
import { extractCodeGraph } from "./extractor.js";
import type { ExtractOptions, IndexResult } from "./types.js";

async function mergeNode(conn: GraphConnection, node: GraphNode): Promise<void> {
  const p = node.properties;
  switch (node.label) {
    case "Module":
      await conn.query("MERGE (n:Module {id: $id}) SET n.path = $path", {
        id: node.id,
        path: String(p.path),
      });
      break;
    case "Function":
      await conn.query(
        "MERGE (n:Function {id: $id}) SET n.name = $name, n.file = $file, n.start_line = $start_line, n.confidence = $confidence",
        {
          id: node.id,
          name: String(p.name),
          file: String(p.file),
          start_line: Number(p.start_line),
          confidence: Number(p.confidence),
        },
      );
      break;
    case "Class":
      await conn.query("MERGE (n:Class {id: $id}) SET n.name = $name, n.file = $file", {
        id: node.id,
        name: String(p.name),
        file: String(p.file),
      });
      break;
    default:
      throw new Error(
        `indexer: unsupported node label "${node.label}" (Phase 2 emits Module/Function/Class)`,
      );
  }
}

async function mergeEdge(conn: GraphConnection, edge: GraphEdge): Promise<void> {
  const match = `MATCH (a:${edge.fromLabel} {id: $from}), (b:${edge.toLabel} {id: $to})`;
  const callCount = edge.properties?.call_count;
  if (edge.label === "CALLS" && callCount != null) {
    await conn.query(`${match} MERGE (a)-[r:CALLS]->(b) SET r.call_count = $cc`, {
      from: edge.from,
      to: edge.to,
      cc: Number(callCount),
    });
    return;
  }
  await conn.query(`${match} MERGE (a)-[:${edge.label}]->(b)`, {
    from: edge.from,
    to: edge.to,
  });
}

/**
 * Write a {@link GraphFragment} to the graph. Nodes are written before edges so
 * that edge endpoints always exist.
 */
export async function writeFragment(
  conn: GraphConnection,
  fragment: GraphFragment,
): Promise<void> {
  for (const node of fragment.nodes) {
    await mergeNode(conn, node);
  }
  for (const edge of fragment.edges) {
    await mergeEdge(conn, edge);
  }
}

/**
 * Extract a file's code graph and write it to the connection.
 *
 * @returns counts of what was written (satisfies the Phase 2 indexing surface).
 */
export async function indexFile(
  conn: GraphConnection,
  source: string,
  opts: ExtractOptions,
): Promise<IndexResult> {
  const fragment = extractCodeGraph(source, opts);
  await writeFragment(conn, fragment);

  return {
    module: opts.filePath,
    functions: fragment.nodes.filter((n) => n.label === "Function").length,
    classes: fragment.nodes.filter((n) => n.label === "Class").length,
    calls: fragment.edges.filter((e) => e.label === "CALLS").length,
  };
}
