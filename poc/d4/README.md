# XSPEC-237 D4 PoC — Builder call-chain injection

PoC assets to decide (data-driven) whether injecting CodeSage call-chain
context into the VibeOps Builder prompt actually improves brownfield edits.
See the full design in dev-platform `cross-project/specs/XSPEC-237-D4-poc-builder-callchain.md`
and the decision boundary in `DEC-070`.

> These files are PoC-only. They are **not** part of CodeSage's `src` build
> (excluded from `tsconfig`/`vitest`/`tsup`), so they never ship in the package.

## Contents

| Path | What |
|------|------|
| `fixture/src/*.ts` | A small multi-file TS library (money → pricing → order, inventory → order) with a non-trivial **cross-file** call graph. |
| `fixture/test/order.test.ts` | Baseline behaviour tests — the experiment measures first-pass pass / regressions against these. |
| `tasks.json` | 7 brownfield tasks. `groundTruthCallers` = the call sites that MUST be updated (the "missed call-site" denominator). 5 positive + 2 negative controls (`shouldCallChainHelp: false`). |
| `verify-callgraph.mjs` | Gate: indexes the fixture with CodeSage and checks extracted `callers(X)` matches `tasks.json` ground truth. Run **before** the experiment — inaccurate context invalidates the measurement. |

## Call graph (ground truth)

```
placeOrder → checkStock, reserve, cartTotal      (order.ts → inventory.ts, pricing.ts)
cartTotal  → lineTotal                            (pricing.ts)
lineTotal  → addTax, formatMoney                  (pricing.ts → money.ts)
```

## Run the accuracy gate

```bash
# from the CodeSage repo root
npm run build
node poc/d4/verify-callgraph.mjs   # expect: all callers match ground truth, exit 0
```

## Run the experiment (P5)

`run-experiment.mjs` wires the whole A/B loop. The REAL parts run locally:
index fixture → per-task CodeSage call-chain context (direct callers/callees,
depth 1, matching `groundTruthCallers`) → two arms (control / treatment) →
metrics (missed call-sites, first-pass pass, iterations, cost) → aggregate →
pre-registered GO/NO-GO gate (decision driven by the positive-control tasks).

```bash
npm run build
node poc/d4/run-experiment.mjs        # MODE=mock smoke (default)
N=5 node poc/d4/run-experiment.mjs    # 5 runs/arm/task
```

The Builder call is behind a pluggable `BUILDER_CMD` seam, so the runner stays
VibeOps-agnostic (DEC-070). The full MODE=real chain — workspace prep → invoke
`BUILDER_CMD` → parse output (files[]/patches[]) → apply → run fixture tests →
metrics → aggregate → GO/NO-GO — is **validated end-to-end** with a stub builder.

- **MODE=mock** (default) — a NEUTRAL synthetic builder (same result both arms):
  validates orchestration; no signal by construction (tie → NO-GO). Synthetic,
  banner-labelled; not a measurement.
- **MODE=real + fake-builder** — validates the *whole real chain* without an LLM.
  The fake touches the target + ground-truth caller files (tests stay green):
  ```bash
  MODE=real BUILDER_CMD="node poc/d4/fake-builder.mjs" node poc/d4/run-experiment.mjs
  # → workspace prep, output apply, fixture vitest (firstPassRate=1), metrics, NO-GO
  ```
- **MODE=real + real Builder (subscription OAuth, no paid key)** — swap in the
  VibeOps wrapper. The Builder LLM runs on your Claude subscription, not API $:
  ```bash
  claude setup-token                          # needs a Claude subscription
  export CLAUDE_CODE_OAUTH_TOKEN=<token>       # do NOT set ANTHROPIC_API_KEY
  MODE=real VIBEOPS_DIR=../vibeops \
    BUILDER_CMD="node poc/d4/vibeops-builder-cmd.mjs" \
    node poc/d4/run-experiment.mjs
  ```
  `vibeops-builder-cmd.mjs` injects a `claude-agent-sdk` provider (no apiKeyEnv →
  SDK uses the OAuth token) and runs `cli.ts run builder`. It is a **starting
  point not yet validated** (no token in the dev sandbox); its inline `VERIFY:`
  notes flag the VibeOps-internal assumptions to confirm on the first real run.

Also: build + validate all per-task control/treatment BuilderInputs (no LLM):
```bash
node poc/d4/verify-adapter.mjs
```

> `call_chain_context.callers` (who calls the symbol) is distinct from
> `groundTruthCallers` (who must be *updated*). For internal-refactor negative
> controls they differ on purpose — that gap is the discriminating signal.

Negative-control tasks (`shouldCallChainHelp: false`) must show no treatment
advantage in a real run, else the signal is prompt-length noise rather than the
call chain.
