import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GraphConnection } from "../src/graph-db/connection.js";
import { initSchema } from "../src/graph-db/schema.js";
import { extractCodeGraph, extractProject } from "../src/code-graph/extractor.js";
import { indexFile, indexProject } from "../src/code-graph/indexer.js";

const TS_SAMPLE = `
import { foo } from "./foo";

export function execute(x: number): number {
  const y = helper(x);
  log(y);
  return foo(y);
}

function helper(n: number): number {
  return n + 1;
}

const log = (m: unknown): void => console.log(m);
`;

const CLASS_SAMPLE = `
function helper(n: number): number { return n + 1; }

class Service {
  run(): number {
    return this.execute();
  }
  execute(): number {
    return helper(2);
  }
}
`;

describe("CodeGraph extractor (Phase 2)", () => {
  it("extracts Module, Function and Class nodes with CALLS edges", () => {
    const { nodes, edges } = extractCodeGraph(TS_SAMPLE, { filePath: "src/a.ts" });

    const functions = nodes.filter((n) => n.label === "Function").map((n) => n.properties.name);
    expect(functions.sort()).toEqual(["execute", "helper", "log"]);

    const modules = nodes.filter((n) => n.label === "Module");
    expect(modules).toHaveLength(1);
    expect(modules[0]?.id).toBe("src/a.ts");

    // DEFINES: Module → every Function
    const defines = edges.filter((e) => e.label === "DEFINES");
    expect(defines).toHaveLength(3);

    // CALLS from execute → helper, log (foo is imported → unresolved, dropped)
    const callsFromExecute = edges
      .filter((e) => e.label === "CALLS" && e.from === "src/a.ts#execute")
      .map((e) => e.to)
      .sort();
    expect(callsFromExecute).toEqual(["src/a.ts#helper", "src/a.ts#log"]);
  });

  it("captures class methods as Function nodes and a Class node", () => {
    const { nodes } = extractCodeGraph(CLASS_SAMPLE, { filePath: "src/svc.ts" });

    const classes = nodes.filter((n) => n.label === "Class").map((n) => n.properties.name);
    expect(classes).toEqual(["Service"]);

    const fnNames = nodes.filter((n) => n.label === "Function").map((n) => n.properties.name).sort();
    expect(fnNames).toEqual(["execute", "helper", "run"]);
  });

  it("infers language from extension (.js parses too)", () => {
    const js = `function a(){ return b(); } function b(){ return 1; }`;
    const { edges } = extractCodeGraph(js, { filePath: "x.js" });
    const calls = edges.filter((e) => e.label === "CALLS");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.from).toBe("x.js#a");
    expect(calls[0]?.to).toBe("x.js#b");
  });
});

// One shared Kuzu connection for the whole describe. tree-sitter + Kuzu are
// both native addons sharing libuv; opening/closing a fresh Kuzu DB per test
// (beforeEach) while tree-sitter is loaded leaves a handle that keeps the
// forks worker from exiting. A single open/close avoids it. Tests stay
// independent by scoping queries to a per-test file path.
describe("CodeGraph indexer + AC-2 query", () => {
  let dir: string;
  let conn: GraphConnection;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "codesage-cg-"));
    conn = GraphConnection.open(join(dir, "graph.db"));
    await initSchema(conn);
  });

  afterAll(() => {
    // NOTE: we deliberately do NOT await conn.close() here. Kuzu's native
    // db.close() can intermittently deadlock when tree-sitter is also loaded in
    // the same forks worker (both are native addons on the shared libuv loop),
    // which produced flaky non-zero exit codes even though all tests passed.
    // The temp DB is reclaimed when the worker exits + rmSync below; long-lived
    // production connections close at process shutdown where this is moot.
    rmSync(dir, { recursive: true, force: true });
  });

  // AC-2: index a TS file, then the canonical "which functions does execute
  // call?" Cypher query returns the correct callee list.
  it("AC-2: MATCH (f:Function)-[:CALLS]->(g) WHERE f.name = 'execute' returns callees", async () => {
    const result = await indexFile(conn, TS_SAMPLE, { filePath: "src/a.ts" });
    expect(result.functions).toBe(3);
    expect(result.calls).toBe(2);

    const rows = await conn.query(
      `MATCH (f:Function)-[:CALLS]->(g:Function) WHERE f.name = 'execute' AND f.file = 'src/a.ts' RETURN g.name AS name ORDER BY name`,
    );
    expect(rows.map((r) => r.name)).toEqual(["helper", "log"]);
  });

  it("is idempotent — re-indexing the same file does not duplicate nodes", async () => {
    await indexFile(conn, TS_SAMPLE, { filePath: "src/b.ts" });
    await indexFile(conn, TS_SAMPLE, { filePath: "src/b.ts" });

    const fnCount = await conn.query(
      `MATCH (f:Function) WHERE f.file = 'src/b.ts' RETURN count(f) AS c`,
    );
    expect(Number(fnCount[0]?.c)).toBe(3);

    const callCount = await conn.query(
      `MATCH (f:Function)-[r:CALLS]->(:Function) WHERE f.file = 'src/b.ts' RETURN count(r) AS c`,
    );
    expect(Number(callCount[0]?.c)).toBe(2);
  });

  // P1: indexProject resolves a cross-file call, so "callers of X" works even
  // when the caller lives in another file (the call-chain the D4 PoC needs).
  it("P1: indexProject finds a cross-file caller", async () => {
    const result = await indexProject(conn, [
      { path: "proj/a.ts", source: "import { helperX } from './b';\nexport function executeX(n: number) { return helperX(n); }" },
      { path: "proj/b.ts", source: "export function helperX(n: number) { return n + 1; }" },
    ]);
    expect(result.calls).toBeGreaterThanOrEqual(1);

    const callers = await conn.query(
      "MATCH (c:Function)-[:CALLS]->(f:Function {name: 'helperX'}) RETURN c.name AS name",
    );
    expect(callers.map((r) => r.name)).toContain("executeX");
  });
});

describe("CodeGraph cross-file resolution (P1)", () => {
  it("resolves a call to a function defined in another file", () => {
    const { fragment, calls } = extractProject([
      { path: "a.ts", source: "export function execute(x: number) { return helper(x); }" },
      { path: "b.ts", source: "export function helper(n: number) { return n + 1; }" },
    ]);
    expect(calls).toBe(1);
    const callEdge = fragment.edges.find((e) => e.label === "CALLS");
    expect(callEdge?.from).toBe("a.ts#execute");
    expect(callEdge?.to).toBe("b.ts#helper"); // resolved across files
  });

  it("prefers a same-file definition (lexical shadowing) over a cross-file one", () => {
    const { fragment } = extractProject([
      { path: "c.ts", source: "export function helper() { return 1; }\nexport function run() { return helper(); }" },
      { path: "d.ts", source: "export function helper() { return 2; }" },
    ]);
    const runCall = fragment.edges.find((e) => e.label === "CALLS" && e.from === "c.ts#run");
    expect(runCall?.to).toBe("c.ts#helper"); // local wins, not d.ts#helper
  });

  it("skips an ambiguous call (name defined in >1 file, no local) and counts it", () => {
    const result = extractProject([
      { path: "e.ts", source: "export function helper() { return 1; }" },
      { path: "f.ts", source: "export function helper() { return 2; }" },
      { path: "g.ts", source: "export function caller() { return helper(); }" },
    ]);
    expect(result.ambiguous).toBeGreaterThanOrEqual(1);
    const callerEdge = result.fragment.edges.find(
      (e) => e.label === "CALLS" && e.from === "g.ts#caller",
    );
    expect(callerEdge).toBeUndefined(); // ambiguous → not resolved
  });

  it("counts an unresolved call (callee name unknown across the repo)", () => {
    const result = extractProject([
      { path: "h.ts", source: "export function caller() { return missingFn(); }" },
    ]);
    expect(result.unresolved).toBeGreaterThanOrEqual(1);
  });
});
