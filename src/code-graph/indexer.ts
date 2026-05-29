/**
 * CodeGraph indexer — extract a file's code graph and write it to Kuzu.
 *
 * Persistence is delegated to the shared, idempotent
 * {@link writeFragment} (graph-db/writer); this module owns extraction +
 * the per-file index summary.
 */

import type { GraphConnection } from "../graph-db/connection.js";
import { writeFragment } from "../graph-db/writer.js";
import { extractCodeGraph } from "./extractor.js";
import type { ExtractOptions, IndexResult } from "./types.js";

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
