import { describe, it, expect } from "vitest";
import { join } from "node:path";

import {
  MarkdownKnowledgeSource,
  parseFrontMatter,
  extractRefs,
} from "../src/adapters/knowledge-source.js";
import {
  SingleRepoIsolation,
  OrgProjectIsolation,
} from "../src/adapters/isolation.js";
import {
  GitHistorySignalSource,
  TestExitCodeSignalSource,
} from "../src/adapters/signal-source.js";

describe("MarkdownKnowledgeSource (generic default)", () => {
  it("parses front-matter + [[ref]] links into Doc nodes and REFERENCES edges", async () => {
    const doc = {
      content: [
        "---",
        "id: NOTE-1",
        "title: First Note",
        "status: active",
        "---",
        "",
        "This note links to [[NOTE-2]] and also [[NOTE-3]].",
        "It repeats [[NOTE-2]] which should not duplicate.",
      ].join("\n"),
    };

    const source = new MarkdownKnowledgeSource([doc]);
    const { nodes, edges } = await source.ingest();

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      label: "Doc",
      id: "NOTE-1",
      properties: { title: "First Note", status: "active", confidence: 1.0 },
    });

    // Deduped refs → 2 edges.
    expect(edges).toHaveLength(2);
    const targets = edges.map((e) => e.to).sort();
    expect(targets).toEqual(["NOTE-2", "NOTE-3"]);
    expect(edges.every((e) => e.label === "REFERENCES")).toBe(true);
    expect(edges.every((e) => e.from === "NOTE-1")).toBe(true);
  });

  it("uses fallbackId when front-matter has no id", async () => {
    const source = new MarkdownKnowledgeSource([
      { content: "# no front matter\n[[X]]", fallbackId: "path/to/file.md" },
    ]);
    const { nodes, edges } = await source.ingest();
    expect(nodes[0]?.id).toBe("path/to/file.md");
    expect(edges[0]?.to).toBe("X");
  });

  it("skips documents with no identity", async () => {
    const source = new MarkdownKnowledgeSource([{ content: "no id here" }]);
    const { nodes, edges } = await source.ingest();
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("parseFrontMatter and extractRefs work standalone", () => {
    const { fields, body } = parseFrontMatter("---\nid: A\n---\nbody [[B]]");
    expect(fields.id).toBe("A");
    expect(extractRefs(body)).toEqual(["B"]);
  });
});

describe("SingleRepoIsolation (default)", () => {
  it("returns a single graph.db path, ignoring context", () => {
    const iso = new SingleRepoIsolation("/data");
    expect(iso.dbPath()).toBe(join("/data", "graph.db"));
    expect(iso.dbPath({ orgId: "x", projectId: "y" })).toBe(
      join("/data", "graph.db"),
    );
  });
});

describe("OrgProjectIsolation (opt-in shape, Phase 6)", () => {
  it("derives org/project nested path", () => {
    const iso = new OrgProjectIsolation("/g");
    expect(iso.dbPath({ orgId: "o1", projectId: "p1" })).toBe(
      join("/g", "org-o1", "project-p1", "graph.db"),
    );
    expect(iso.sharedDbPath()).toBe(
      join("/g", "shared", "public-knowledge.db"),
    );
  });

  it("requires both orgId and projectId", () => {
    const iso = new OrgProjectIsolation();
    expect(() => iso.dbPath({ orgId: "o1" })).toThrow();
    expect(() => iso.dbPath()).toThrow();
  });
});

describe("SignalSource defaults (Phase 1 stubs)", () => {
  it("git history producer returns no events yet", async () => {
    expect(await new GitHistorySignalSource().collect()).toEqual([]);
  });
  it("test exit-code producer returns no events yet", async () => {
    expect(await new TestExitCodeSignalSource().collect()).toEqual([]);
  });
});
