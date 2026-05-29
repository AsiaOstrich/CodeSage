/**
 * CodeGraph module types (XSPEC-237 Phase 2).
 *
 * The extractor turns source files into a provider-agnostic
 * {@link GraphFragment} (defined in graph-db/types); these types describe the
 * extractor/indexer surface.
 */

/** Languages the extractor can parse with the bundled tree-sitter grammars. */
export type SupportedLanguage = "typescript" | "tsx" | "javascript";

export interface ExtractOptions {
  /**
   * Path of the file being parsed. Used as the Module id and as the prefix of
   * every Function/Class id, so it should be stable across re-indexing
   * (a repo-relative path is recommended).
   */
  filePath: string;
  /**
   * Override language detection. When omitted it is inferred from the
   * `filePath` extension (.ts/.mts/.cts → typescript, .tsx → tsx,
   * .js/.jsx/.mjs/.cjs → javascript).
   */
  language?: SupportedLanguage;
}

/** Summary of what {@link indexFile} wrote to the graph. */
export interface IndexResult {
  /** Module node id (the file path). */
  module: string;
  functions: number;
  classes: number;
  /** Number of resolved CALLS edges written. */
  calls: number;
}
