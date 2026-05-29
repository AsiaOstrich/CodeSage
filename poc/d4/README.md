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

## Experiment outline (next: P5)

Two arms via VibeOps `prompt-experiment-runner`:
- **control** — Builder, no call-chain context.
- **treatment** — Builder + CodeSage `callers`/`callees` of the task's target symbol.

For each task × N runs, measure: missed call-sites (vs `groundTruthCallers`),
first-pass test pass / self-debug iterations, regressions, token cost, UAT
6-dimension score. Apply the pre-registered GO/NO-GO thresholds in the design
doc. Negative-control tasks must show no treatment advantage (else the signal
is prompt-length noise, not the call chain).
