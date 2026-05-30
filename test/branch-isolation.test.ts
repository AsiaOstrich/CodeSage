import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { resolveDbPath } from "../src/graph-db/open.js";
import { sanitizeBranch } from "../src/graph-db/git-branch.js";
import { GraphConnection } from "../src/graph-db/connection.js";
import { initSchema, clearGraph } from "../src/graph-db/schema.js";
import { indexProject } from "../src/code-graph/index.js";
import { cmdGc } from "../src/cli/run.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "codesage-iso-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t.dev"]);
  git(dir, ["config", "user.name", "t"]);
  return dir;
}

describe("sanitizeBranch", () => {
  it("is filesystem-safe and collision-free", () => {
    const a = sanitizeBranch("feature/x");
    const b = sanitizeBranch("feature-x");
    expect(a).not.toMatch(/[/\\]/); // no path separators
    expect(a).not.toBe(b); // distinct branches never collide (hash suffix)
    expect(sanitizeBranch("feature/x")).toBe(a); // deterministic
  });
});

describe("resolveDbPath priority (XSPEC-245)", () => {
  const saved = { db: process.env.CODESAGE_DB, iso: process.env.CODESAGE_ISOLATION };
  beforeEach(() => {
    delete process.env.CODESAGE_DB;
    delete process.env.CODESAGE_ISOLATION;
  });
  afterAll(() => {
    if (saved.db != null) process.env.CODESAGE_DB = saved.db;
    if (saved.iso != null) process.env.CODESAGE_ISOLATION = saved.iso;
  });

  it("defaults to single ./.codesage/graph.db", () => {
    expect(resolveDbPath({ cwd: "/tmp/proj" })).toBe("/tmp/proj/.codesage/graph.db");
  });

  it("CODESAGE_DB env wins over everything", () => {
    process.env.CODESAGE_DB = "/abs/custom.db";
    expect(resolveDbPath({ cwd: "/tmp/proj", graph: "x", isolation: "git-branch" })).toBe("/abs/custom.db");
  });

  it("--graph names the file under .codesage", () => {
    expect(resolveDbPath({ cwd: "/tmp/proj", graph: "clientX" })).toBe("/tmp/proj/.codesage/clientX.db");
  });

  it("git-branch isolation maps to per-branch DB under the git dir", () => {
    const repo = initRepo();
    try {
      const onMain = resolveDbPath({ cwd: repo, isolation: "git-branch" });
      expect(onMain).toContain("/.git/codesage/");
      expect(onMain).toContain(sanitizeBranch("main"));

      git(repo, ["checkout", "-b", "feature/x"]);
      const onFeature = resolveDbPath({ cwd: repo, isolation: "git-branch" });
      // AC-1: different branch → different DB file (no cross-pollution)
      expect(onFeature).not.toBe(onMain);
      expect(onFeature).toContain(sanitizeBranch("feature/x"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("git-branch falls back to single default outside a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "codesage-nogit-"));
    try {
      expect(resolveDbPath({ cwd: dir, isolation: "git-branch" })).toBe(join(dir, ".codesage", "graph.db"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cmdGc (XSPEC-245 AC-4)", () => {
  it("lists/removes orphan branch graphs, keeps live ones", () => {
    const repo = initRepo();
    try {
      git(repo, ["commit", "--allow-empty", "-m", "init"]); // main becomes a real ref
      const codesageDir = join(repo, ".git", "codesage");
      mkdirSync(codesageDir, { recursive: true });
      const live = `${sanitizeBranch("main")}.db`;
      const orphan = `${sanitizeBranch("deleted-branch")}.db`;
      writeFileSync(join(codesageDir, live), "x");
      writeFileSync(join(codesageDir, orphan), "x");

      const dry = cmdGc({ cwd: repo, dryRun: true });
      expect(dry.orphans).toEqual([orphan]);
      expect(dry.deleted).toBe(false);

      const run = cmdGc({ cwd: repo, dryRun: false });
      expect(run.orphans).toEqual([orphan]);
      expect(run.deleted).toBe(true);

      const after = cmdGc({ cwd: repo, dryRun: true });
      expect(after.orphans).toEqual([]); // orphan gone, live kept
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reports null dir outside a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "codesage-nogit-"));
    try {
      expect(cmdGc({ cwd: dir, dryRun: true }).dir).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Native (kuzu + tree-sitter): single shared conn, no awaited close (teardown caveat).
describe("clearGraph prune (XSPEC-245 AC-2)", () => {
  let dir: string;
  let conn: GraphConnection;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "codesage-clean-"));
    conn = GraphConnection.open(join(dir, "g.db"));
    await initSchema(conn);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes all data so a re-index prunes deleted nodes", async () => {
    await indexProject(conn, [{ path: "a.ts", source: "export function a(){ return 1; }" }]);
    const before = await conn.query("MATCH (f:Function) RETURN count(f) AS n");
    expect(Number(before[0]!.n)).toBeGreaterThan(0);

    await clearGraph(conn);
    const after = await conn.query("MATCH (f:Function) RETURN count(f) AS n");
    expect(Number(after[0]!.n)).toBe(0);
  });
});
