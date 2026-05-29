/**
 * XSPEC-237 D4 — real BUILDER_CMD wrapper (VibeOps Builder via subscription OAuth).
 *
 * ⚠️ STARTING POINT, NOT YET VALIDATED. The rest of the harness (workspace prep,
 * output parse/apply, fixture tests, metrics) is validated via fake-builder.mjs.
 * This wrapper is the one seam that needs a Claude subscription token + a real
 * run to confirm; the inline "VERIFY:" notes mark VibeOps-internal assumptions.
 *
 * Contract (env, set by run-experiment.mjs): D4_INPUT, D4_WORKSPACE, D4_OUTPUT.
 * Also required: VIBEOPS_DIR (path to the vibeops repo), CLAUDE_CODE_OAUTH_TOKEN
 * (from `claude setup-token`). Do NOT set ANTHROPIC_API_KEY (so the SDK uses the
 * subscription OAuth path, not paid API billing).
 *
 * Usage:
 *   claude setup-token                       # needs a Claude subscription
 *   export CLAUDE_CODE_OAUTH_TOKEN=<token>
 *   MODE=real VIBEOPS_DIR=../vibeops \
 *     BUILDER_CMD="node poc/d4/vibeops-builder-cmd.mjs" \
 *     node poc/d4/run-experiment.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { D4_INPUT, D4_WORKSPACE, D4_OUTPUT, D4_TASK, VIBEOPS_DIR } = process.env;
const MODEL = process.env.D4_MODEL ?? "claude-sonnet-4-6";

if (!VIBEOPS_DIR) throw new Error("set VIBEOPS_DIR to the vibeops repo path");
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  throw new Error("set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`); leave ANTHROPIC_API_KEY unset");
}

// 1. Inject a claude-agent-sdk provider (no apiKeyEnv → SDK falls back to the
//    ambient CLAUDE_CODE_OAUTH_TOKEN) and point the Builder at it + the
//    per-task workspace. VERIFY: provider/agent/sandbox/pipeline field names
//    against the current shared/config.schema.json on first run.
const config = JSON.parse(readFileSync(join(VIBEOPS_DIR, "vibeops.config.json"), "utf8"));
config.providers ??= {};
config.providers["codesage-poc"] = {
  type: "claude-agent-sdk",
  model: MODEL,
  sandbox: { localWorkDir: D4_WORKSPACE }, // VERIFY: where claude-agent-sdk reads cwd
};
config.agents ??= {};
config.agents.builder = { ...(config.agents.builder ?? {}), provider: "codesage-poc" };
config.pipeline ??= {};
config.pipeline.artifactsDir = join(D4_WORKSPACE, "artifacts");
config.projectPath = D4_WORKSPACE;

const cfgPath = join(tmpdir(), `d4-vibeops-config-${D4_TASK}.json`);
writeFileSync(cfgPath, JSON.stringify(config, null, 2));

// 2. Run the Builder agent. cwd must be VIBEOPS_DIR (agents/builder/prompt.md
//    resolves from process.cwd()). VERIFY: the CLI prints "📋 Result:" then the
//    output JSON — adjust the parse below if the format changes.
const raw = execSync(`npx tsx src/infrastructure/cli/cli.ts run builder --input "${D4_INPUT}"`, {
  cwd: VIBEOPS_DIR,
  encoding: "utf8",
  env: { ...process.env, VIBEOPS_CONFIG_PATH: cfgPath },
  maxBuffer: 64 * 1024 * 1024,
});

// 3. Extract the JSON result and hand it back to the runner.
const marker = raw.lastIndexOf("{");
const jsonText = marker >= 0 ? raw.slice(marker) : raw;
let result;
try {
  result = JSON.parse(jsonText);
} catch {
  // Fallback: find the first balanced JSON object after "Result:"
  const idx = raw.indexOf("Result:");
  result = JSON.parse(raw.slice(raw.indexOf("{", idx)));
}
writeFileSync(D4_OUTPUT, JSON.stringify(result, null, 2));
console.log(`[vibeops-builder] ${D4_TASK}: builder output captured`);
