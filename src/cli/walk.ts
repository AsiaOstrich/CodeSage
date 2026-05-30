/**
 * Recursive file discovery for the `codesage index` command. Returns
 * `{ path, source }` tuples with repo-relative paths, skipping common
 * non-source dirs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".codesage", ".git", "coverage"]);

/** Recursively collect files under `root` whose name ends with one of `exts`. */
export function walkFiles(root: string, exts: readonly string[]): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = [];
  const rec = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) rec(full);
      } else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith(".d.ts")) {
        out.push({ path: relative(root, full), source: readFileSync(full, "utf8") });
      }
    }
  };
  rec(root);
  return out;
}
