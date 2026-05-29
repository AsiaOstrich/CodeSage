/**
 * KnowledgeGraph module types (XSPEC-237 Phase 3).
 *
 * The AsiaOstrich *reference* knowledge adapter: XSPEC → Spec nodes, DEC/ADR →
 * Decision nodes, `[[ref]]` links → IMPACTS / SUPERSEDES edges. The generic,
 * provider-agnostic default lives in adapters/knowledge-source (Doc nodes).
 */

/** Which graph node table an id maps to. */
export type KnowledgeNodeKind = "Spec" | "Decision";

/** A single XSPEC/DEC/ADR markdown document fed to the knowledge source. */
export interface KnowledgeDoc {
  /** Document content, optionally beginning with a `---` front-matter block. */
  content: string;
  /**
   * Fallback id (e.g. file path or `XSPEC-205`) used when the content has no
   * `id` front-matter field and no recognisable id in its body.
   */
  fallbackId?: string;
}

/** One node in an impact chain returned by impact analysis. */
export interface ImpactNode {
  id: string;
  title: string;
  /** "direct" = impacts the spec directly; "supersedes" = reached via a chain. */
  via: "direct" | "supersedes";
}

export interface ImpactAnalysisResult {
  nodeId: string;
  /** Decisions in the impact chain of the queried spec. */
  decisions: ImpactNode[];
}
