/**
 * XSPEC-237 D4 — fake Builder (a BUILDER_CMD stub for harness validation).
 *
 * Stands in for the real VibeOps Builder so the MODE=real chain (workspace →
 * invoke → parse output → apply → run tests → metrics) can be validated WITHOUT
 * an LLM. It is NEUTRAL across arms (reads D4_ARM but ignores it) so it produces
 * no signal — its only job is to prove the plumbing. NOT a measurement.
 *
 * Contract (env): D4_WORKSPACE, D4_OUTPUT, D4_TASK.
 * Emits an output-schema-shaped JSON whose files[] "touch" the target file and
 * every ground-truth caller file with a marker comment (keeps tests green).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(HERE, "tasks.json"), "utf8"));

const ws = process.env.D4_WORKSPACE;
const outPath = process.env.D4_OUTPUT;
const taskId = process.env.D4_TASK;
const task = tasks.tasks.find((t) => t.id === taskId);
if (!ws || !outPath || !task) {
  console.error("[fake-builder] missing D4_WORKSPACE/D4_OUTPUT/D4_TASK");
  process.exit(2);
}

// fixture layout: function name → file (harness stub knowledge, not the LLM's).
const fileOf = {
  formatMoney: "src/money.ts",
  addTax: "src/money.ts",
  lineTotal: "src/pricing.ts",
  cartTotal: "src/pricing.ts",
  checkStock: "src/inventory.ts",
  reserve: "src/inventory.ts",
  placeOrder: "src/order.ts",
};

const toTouch = new Set([task.targetFile, ...task.groundTruthCallers.map((c) => fileOf[c]).filter(Boolean)]);
const files = [...toTouch].map((path) => ({
  path,
  action: "update",
  content: `${readFileSync(join(ws, path), "utf8")}\n// [d4-fake-builder] touched for ${taskId}\n`,
}));

writeFileSync(outPath, JSON.stringify({ source_agent: "builder", files, iterations: 1, costUSD: 0 }, null, 2));
console.log(`[fake-builder] ${taskId}: emitted ${files.length} file edit(s)`);
