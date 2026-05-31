/**
 * XSPEC-237 D4 PoC — verify EngramGraph extracts the fixture's call graph
 * correctly (precision/recall of "callers of X" vs the hand-labelled ground
 * truth in tasks.json). If this fails, the PoC measurement is invalid, so this
 * gate runs BEFORE the main experiment.
 *
 * Usage: from EngramGraph repo root, after `npm run build`:
 *   node poc/d4/verify-callgraph.mjs
 */

import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GraphConnection, initSchema, indexProject, callers } from "../../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "fixture", "src");
const tasks = JSON.parse(readFileSync(join(HERE, "tasks.json"), "utf8"));

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ path: `src/${f}`, source: readFileSync(join(SRC, f), "utf8") }));

const dbDir = join(tmpdir(), "engram-d4-verify");
rmSync(dbDir, { recursive: true, force: true });
mkdirSync(dbDir, { recursive: true });
const conn = GraphConnection.open(join(dbDir, "graph.db"));

let failures = 0;
await initSchema(conn);
const stats = await indexProject(conn, files);
console.log(
  `indexed ${stats.files} files, ${stats.functions} functions, ${stats.calls} calls ` +
    `(ambiguous=${stats.ambiguous}, unresolved=${stats.unresolved})\n`,
);

for (const [symbol, expected] of Object.entries(tasks.callGraph)) {
  const got = (await callers(conn, symbol, 1)).map((n) => n.name).sort();
  const want = [...expected].sort();
  const ok = got.length === want.length && got.every((n, i) => n === want[i]);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"}  callers(${symbol}): got [${got}] want [${want}]`);
}

// NOTE: do not await conn.close() — Kuzu's native close can segfault when
// tree-sitter is co-loaded (same issue documented in the test suite). The OS
// reclaims the temp DB; we exit explicitly with the result code.
if (failures > 0) {
  console.error(`\n${failures} mismatch(es) — call-graph extraction is NOT ground-truth accurate.`);
  process.exit(1);
}
console.log("\nAll callers match ground truth — extraction is accurate; PoC may proceed.");
process.exit(0);
