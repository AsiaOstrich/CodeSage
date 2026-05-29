/**
 * XSPEC-237 D4 PoC — A/B experiment runner (P5).
 *
 * index fixture → per-task CodeSage call-chain context → run the Builder for
 * control (no context) and treatment (+ context) arms → metrics → aggregate →
 * pre-registered GO/NO-GO gate (decision driven by the positive-control tasks).
 *
 * The Builder is invoked through a pluggable BUILDER_CMD seam, so this script
 * stays VibeOps-agnostic (DEC-070). The command receives, via env:
 *   D4_INPUT     — path to the schema-valid BuilderInput JSON (from the adapter)
 *   D4_WORKSPACE — a git-initialised copy of the fixture to edit
 *   D4_OUTPUT    — path to write the Builder output JSON (files[]/patches[])
 *   D4_TASK / D4_ARM — task id and arm label
 * The runner then applies files[]/patches[], runs the fixture tests, and scores.
 *
 *   MODE=mock (default)  — neutral synthetic builder (identical both arms);
 *                          validates orchestration; no signal (tie → NO-GO).
 *   MODE=real BUILDER_CMD=...  — real builder. Validate the whole chain with the
 *                          bundled stub:
 *        MODE=real BUILDER_CMD="node poc/d4/fake-builder.mjs" node poc/d4/run-experiment.mjs
 *                          For the real LLM, point BUILDER_CMD at the VibeOps
 *                          wrapper (see README) with CLAUDE_CODE_OAUTH_TOKEN set.
 */

import {
  readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, cpSync, symlinkSync, existsSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GraphConnection, initSchema, indexProject, callChain } from "../../dist/index.js";
import { toBuilderInput, validateBuilderInput } from "./brownfield-adapter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixture");
const SRC = join(FIXTURE, "src");
const CODESAGE_ROOT = resolve(HERE, "..", "..");
const MODE = process.env.MODE ?? "mock";
const BUILDER_CMD = process.env.BUILDER_CMD;
const N = Number(process.env.N ?? (MODE === "mock" ? 2 : 1));
const GATE = { missedCallSitesDropPct: 50, firstPassGainPct: 20 };

const tasks = JSON.parse(readFileSync(join(HERE, "tasks.json"), "utf8"));
const fixtureFiles = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ path: `src/${f}`, source: readFileSync(join(SRC, f), "utf8") }));

// --- 1. Index fixture + per-task call-chain context (REAL) -------------------

async function buildContexts() {
  const dbDir = join(tmpdir(), "codesage-d4-exp");
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  const conn = GraphConnection.open(join(dbDir, "graph.db"));
  await initSchema(conn);
  await indexProject(conn, fixtureFiles);

  const contexts = {};
  for (const task of tasks.tasks) {
    // depth 1 = direct callers — the exact set that must change (matches ground truth)
    const chain = await callChain(conn, task.targetSymbol, "both", 1);
    contexts[task.id] = {
      symbol: task.targetSymbol,
      callers: chain.callers.map((c) => c.name),
      callees: chain.callees.map((c) => c.name),
      callerFiles: Object.fromEntries(chain.callers.map((c) => [c.name, c.file])),
      block:
        `## Call chain for ${task.targetSymbol} (from CodeSage)\n` +
        `Direct callers (review/update on a signature or behaviour change): ` +
        `${chain.callers.map((c) => `${c.name} (${c.file})`).join(", ") || "(none)"}\n` +
        `Direct callees: ${chain.callees.map((c) => c.name).join(", ") || "(none)"}`,
    };
  }
  // do NOT await conn.close() — kuzu native close segfaults with tree-sitter loaded
  return contexts;
}

// --- 2. Builder adapter (pluggable BUILDER_CMD) -----------------------------

function prepWorkspace(task, arm, ctx) {
  const { builderInput, specArtifact, specPath } = toBuilderInput(
    task, fixtureFiles, arm === "treatment" ? ctx : null, "2026-05-30T00:00:00.000Z",
  );
  const errs = validateBuilderInput(builderInput);
  if (errs.length) throw new Error(`adapter produced invalid BuilderInput: ${errs.join("; ")}`);

  const ws = join(tmpdir(), `d4-ws-${task.id}-${arm}`);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  cpSync(FIXTURE, ws, { recursive: true });
  execSync("git init -q && git add -A && git -c user.email=d4@poc -c user.name=d4 commit -qm base", { cwd: ws });

  mkdirSync(join(ws, dirname(specPath)), { recursive: true });
  writeFileSync(join(ws, specPath), JSON.stringify(specArtifact, null, 2));
  const inputPath = join(ws, "builder-input.json");
  writeFileSync(inputPath, JSON.stringify(builderInput, null, 2));
  return { ws, inputPath, outputPath: join(ws, "builder-output.json") };
}

function applyOutput(ws, out) {
  const modified = new Set();
  for (const f of out.files ?? []) {
    if (!f.path) continue;
    mkdirSync(join(ws, dirname(f.path)), { recursive: true });
    writeFileSync(join(ws, f.path), f.content ?? "");
    modified.add(f.path);
  }
  for (const p of out.patches ?? []) {
    const diff = typeof p === "string" ? p : (p.diff ?? p.patch ?? "");
    if (!diff) continue;
    writeFileSync(join(ws, ".d4.patch"), diff);
    execSync("git apply .d4.patch", { cwd: ws });
    for (const m of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) modified.add(m[1]);
  }
  return [...modified];
}

function runFixtureTests(ws) {
  const nm = join(ws, "node_modules");
  if (!existsSync(nm)) symlinkSync(join(CODESAGE_ROOT, "node_modules"), nm, "dir");
  try {
    execSync("npx vitest run", { cwd: ws, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ modifiedFiles: string[], firstPassPass: boolean, iterations: number, costUSD: number }} */
async function runBuilder(task, arm, ctx) {
  if (MODE === "mock") {
    // NEUTRAL synthetic: both arms "touch" all ground-truth caller files → no
    // signal by construction. SYNTHETIC, not a measurement.
    return {
      modifiedFiles: task.groundTruthCallers.map((c) => ctx.callerFiles[c]).filter(Boolean),
      firstPassPass: true,
      iterations: 1,
      costUSD: 0.01,
    };
  }
  if (!BUILDER_CMD) {
    throw new Error(
      "MODE=real needs BUILDER_CMD. Validate the harness with: " +
        'BUILDER_CMD="node poc/d4/fake-builder.mjs"; for the real LLM see README.',
    );
  }
  const { ws, inputPath, outputPath } = prepWorkspace(task, arm, ctx);
  execSync(BUILDER_CMD, {
    cwd: CODESAGE_ROOT,
    stdio: "inherit",
    env: { ...process.env, D4_INPUT: inputPath, D4_WORKSPACE: ws, D4_OUTPUT: outputPath, D4_TASK: task.id, D4_ARM: arm },
  });
  const out = JSON.parse(readFileSync(outputPath, "utf8"));
  const modifiedFiles = applyOutput(ws, out);
  const firstPassPass = runFixtureTests(ws);
  return { modifiedFiles, firstPassPass, iterations: out.iterations ?? 1, costUSD: out.costUSD ?? 0 };
}

// --- 3. Metrics (REAL) ------------------------------------------------------

function metricsFor(task, ctx, builderResult) {
  const modified = new Set(builderResult.modifiedFiles);
  let missed = 0;
  for (const caller of task.groundTruthCallers) {
    const file = ctx.callerFiles[caller];
    if (!file || !modified.has(file)) missed++;
  }
  return {
    missedCallSites: missed,
    firstPassPass: builderResult.firstPassPass ? 1 : 0,
    iterations: builderResult.iterations,
    costUSD: builderResult.costUSD,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// --- 4. Run + aggregate + GO/NO-GO ------------------------------------------

async function main() {
  const contexts = await buildContexts();
  console.log(
    `\n${MODE === "mock"
      ? "*** MODE=mock — SYNTHETIC neutral data, harness validation only. NOT a measurement. ***"
      : `MODE=real (N=${N}, BUILDER_CMD=${BUILDER_CMD})`}\n`,
  );

  const agg = { control: [], treatment: [] };
  const positive = { control: [], treatment: [] };

  for (const task of tasks.tasks) {
    for (const arm of ["control", "treatment"]) {
      for (let i = 0; i < N; i++) {
        const ctx = contexts[task.id];
        const result = await runBuilder(task, arm, arm === "treatment" ? ctx : { ...ctx, block: undefined });
        const m = metricsFor(task, ctx, result);
        agg[arm].push(m);
        if (task.shouldCallChainHelp) positive[arm].push(m);
      }
    }
    console.log(`task ${task.id} (${task.type}, helps=${task.shouldCallChainHelp}) — call-chain=[${contexts[task.id].callers.join(", ") || "none"}], must-update=${task.groundTruthCallers.length}`);
  }

  const summarize = (rows) => ({
    missedCallSites: mean(rows.map((r) => r.missedCallSites)),
    firstPassRate: mean(rows.map((r) => r.firstPassPass)),
    iterations: mean(rows.map((r) => r.iterations)),
    costUSD: mean(rows.map((r) => r.costUSD)),
  });

  const c = summarize(positive.control);
  const t = summarize(positive.treatment);
  const missedDropPct = c.missedCallSites === 0 ? 0 : ((c.missedCallSites - t.missedCallSites) / c.missedCallSites) * 100;
  const firstPassGainPct = c.firstPassRate === 0 ? 0 : ((t.firstPassRate - c.firstPassRate) / c.firstPassRate) * 100;
  const go = missedDropPct >= GATE.missedCallSitesDropPct || firstPassGainPct >= GATE.firstPassGainPct;

  console.log("\n--- aggregate (positive-control tasks) ---");
  console.log("control  :", c);
  console.log("treatment:", t);
  console.log(`missed call-sites drop: ${missedDropPct.toFixed(1)}% (gate ≥${GATE.missedCallSitesDropPct}%)`);
  console.log(`first-pass rate gain  : ${firstPassGainPct.toFixed(1)}% (gate ≥${GATE.firstPassGainPct}%)`);
  console.log(`\nDECISION: ${go ? "GO (build sidecar)" : "NO-GO"}${MODE === "mock" ? "  [SYNTHETIC — not a real decision]" : ""}`);
  process.exit(0);
}

main();
