/**
 * Generic graph writer — idempotently MERGE a {@link GraphFragment} into Kuzu.
 *
 * Handles every NODE / REL label in the schema, so CodeGraph (Function/Class/
 * Module), KnowledgeGraph (Spec/Decision/Doc) and any future fragment producer
 * share one writer. Node/edge labels come from the controlled
 * {@link NodeLabel}/{@link RelLabel} unions and are safe to interpolate;
 * property keys are validated as plain identifiers and all values are bound as
 * parameters.
 */

import type { GraphConnection } from "./connection.js";
import type { GraphEdge, GraphFragment, GraphNode } from "./types.js";
import type { KuzuValue } from "kuzu";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeKey(key: string): void {
  if (!IDENTIFIER.test(key)) {
    throw new Error(`writeFragment: unsafe property key "${key}"`);
  }
}

async function mergeNode(conn: GraphConnection, node: GraphNode): Promise<void> {
  const keys = Object.keys(node.properties);
  const params: Record<string, KuzuValue> = { id: node.id };
  const assignments: string[] = [];
  for (const key of keys) {
    assertSafeKey(key);
    params[key] = node.properties[key] as KuzuValue;
    assignments.push(`n.${key} = $${key}`);
  }
  const setClause = assignments.length > 0 ? ` SET ${assignments.join(", ")}` : "";
  await conn.query(`MERGE (n:${node.label} {id: $id})${setClause}`, params);
}

async function mergeEdge(conn: GraphConnection, edge: GraphEdge): Promise<void> {
  const props = edge.properties ?? {};
  const keys = Object.keys(props);
  const params: Record<string, KuzuValue> = { from: edge.from, to: edge.to };
  const assignments: string[] = [];
  for (const key of keys) {
    assertSafeKey(key);
    // prefix to avoid colliding with $from / $to
    params[`p_${key}`] = props[key] as KuzuValue;
    assignments.push(`r.${key} = $p_${key}`);
  }
  const match = `MATCH (a:${edge.fromLabel} {id: $from}), (b:${edge.toLabel} {id: $to})`;
  const setClause = assignments.length > 0 ? ` SET ${assignments.join(", ")}` : "";
  await conn.query(`${match} MERGE (a)-[r:${edge.label}]->(b)${setClause}`, params);
}

/**
 * Write a fragment to the graph. Nodes are written before edges so that edge
 * endpoints always exist. Idempotent: re-writing updates properties in place.
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
