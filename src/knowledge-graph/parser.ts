/**
 * XSPEC/DEC knowledge parser — the AsiaOstrich *reference* knowledge adapter.
 *
 * Each document becomes a Spec (XSPEC-NNN) or Decision (DEC-NNN / ADR-NNN)
 * node, and every `[[ref]]` link becomes a typed cross-domain edge:
 *   - Decision → Spec link  ⇒ IMPACTS (Decision → Spec)
 *   - Spec → Decision link  ⇒ IMPACTS (Decision → Spec)  (decision impacts spec)
 *   - Decision → Decision   ⇒ SUPERSEDES (source → referenced)
 *   - Spec → Spec           ⇒ (no schema edge) skipped
 *
 * Referenced ids absent from the batch get a stub node so the edge still lands;
 * a later parse of the real document MERGE-updates it in place.
 */

import { extractRefs, parseFrontMatter } from "../adapters/knowledge-source.js";
import type { GraphConnection } from "../graph-db/connection.js";
import type { GraphEdge, GraphFragment, GraphNode } from "../graph-db/types.js";
import { writeFragment } from "../graph-db/writer.js";
import { classifyRef } from "./linker.js";
import type { KnowledgeDoc, KnowledgeNodeKind } from "./types.js";

export interface ParsedKnowledgeDoc {
  id: string;
  kind: KnowledgeNodeKind;
  title: string;
  /** Classified outbound references (self-references removed). */
  refs: Array<{ kind: KnowledgeNodeKind; id: string }>;
  node: GraphNode;
}

function firstHeading(body: string): string | null {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? (m[1] ?? "").trim() : null;
}

function makeNode(kind: KnowledgeNodeKind, id: string, title: string, fields: Record<string, string>): GraphNode {
  if (kind === "Spec") {
    return {
      label: "Spec",
      id,
      properties: { title, status: fields.status ?? "unknown", confidence: 1.0 },
    };
  }
  return {
    label: "Decision",
    id,
    properties: { title, date: fields.date ?? "", confidence: 1.0 },
  };
}

function stubNode(kind: KnowledgeNodeKind, id: string): GraphNode {
  return makeNode(kind, id, id, {});
}

/**
 * Parse a single knowledge document, or null when no XSPEC/DEC/ADR id can be
 * resolved (from front-matter `id`, the fallback id, or the body).
 */
export function parseKnowledgeDoc(doc: KnowledgeDoc): ParsedKnowledgeDoc | null {
  const { fields, body } = parseFrontMatter(doc.content);
  const rawId = fields.id ?? doc.fallbackId ?? doc.content;
  const classified = classifyRef(rawId);
  if (!classified) return null;

  const { kind, id } = classified;
  const title = fields.title ?? firstHeading(body) ?? id;

  const refs = extractRefs(body)
    .map(classifyRef)
    .filter((r): r is { kind: KnowledgeNodeKind; id: string } => r !== null && r.id !== id);

  return { id, kind, title, refs, node: makeNode(kind, id, title, fields) };
}

/**
 * AsiaOstrich reference knowledge source: XSPEC/DEC markdown → graph fragment.
 */
export class XspecDecKnowledgeSource {
  constructor(private readonly docs: KnowledgeDoc[]) {}

  async ingest(): Promise<GraphFragment> {
    const parsed = this.docs
      .map(parseKnowledgeDoc)
      .filter((p): p is ParsedKnowledgeDoc => p !== null);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const known = new Map<string, KnowledgeNodeKind>();

    for (const p of parsed) {
      nodes.push(p.node);
      known.set(p.id, p.kind);
    }

    const stubbed = new Set<string>();
    const ensureNode = (kind: KnowledgeNodeKind, id: string): void => {
      if (known.has(id) || stubbed.has(id)) return;
      stubbed.add(id);
      nodes.push(stubNode(kind, id));
    };

    for (const p of parsed) {
      for (const ref of p.refs) {
        ensureNode(ref.kind, ref.id);

        if (p.kind === "Decision" && ref.kind === "Spec") {
          edges.push(impacts(p.id, ref.id));
        } else if (p.kind === "Spec" && ref.kind === "Decision") {
          edges.push(impacts(ref.id, p.id));
        } else if (p.kind === "Decision" && ref.kind === "Decision") {
          edges.push(supersedes(p.id, ref.id));
        }
        // Spec → Spec has no schema edge; skip.
      }
    }

    return { nodes, edges };
  }
}

function impacts(decisionId: string, specId: string): GraphEdge {
  return { label: "IMPACTS", fromLabel: "Decision", from: decisionId, toLabel: "Spec", to: specId };
}

function supersedes(fromId: string, toId: string): GraphEdge {
  return { label: "SUPERSEDES", fromLabel: "Decision", from: fromId, toLabel: "Decision", to: toId };
}

export interface KnowledgeIndexResult {
  specs: number;
  decisions: number;
  impacts: number;
  supersedes: number;
}

/** Ingest XSPEC/DEC docs and write them to the graph. */
export async function indexKnowledgeDocs(
  conn: GraphConnection,
  docs: KnowledgeDoc[],
): Promise<KnowledgeIndexResult> {
  const fragment = await new XspecDecKnowledgeSource(docs).ingest();
  await writeFragment(conn, fragment);
  return {
    specs: fragment.nodes.filter((n) => n.label === "Spec").length,
    decisions: fragment.nodes.filter((n) => n.label === "Decision").length,
    impacts: fragment.edges.filter((e) => e.label === "IMPACTS").length,
    supersedes: fragment.edges.filter((e) => e.label === "SUPERSEDES").length,
  };
}
