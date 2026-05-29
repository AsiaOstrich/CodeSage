import { join } from "node:path";

/**
 * Pluggable isolation-model adapter (XSPEC-237 §"Core vs Adapter 邊界" #2).
 *
 * Decides where a given context's graph database lives on disk. Keeps any
 * multi-tenant (org/project) assumptions out of core: the default is a single
 * graph file with zero org concept; the two-tier org/project model is opt-in
 * for VibeOps enterprise (Phase 6).
 */
export interface IsolationModel {
  /** Resolve the on-disk path of the graph DB for `ctx`. */
  dbPath(ctx?: IsolationContext): string;
}

/** Free-form isolation context. Shape depends on the active model. */
export interface IsolationContext {
  orgId?: string;
  projectId?: string;
}

/**
 * Default model for independent developers: a single `graph.db` file.
 * Context is ignored entirely — there is no org/project notion.
 */
export class SingleRepoIsolation implements IsolationModel {
  /** @param baseDir Directory holding the single graph DB (default: cwd). */
  constructor(
    private readonly baseDir: string = ".",
    private readonly fileName: string = "graph.db",
  ) {}

  dbPath(_ctx?: IsolationContext): string {
    return join(this.baseDir, this.fileName);
  }
}

/**
 * Opt-in two-tier physical isolation (VibeOps enterprise, Phase 6).
 *
 * Layout: `{baseDir}/org-{orgId}/project-{projectId}/graph.db`.
 *
 * NOTE: Phase 1 ships only the *shape*; the default wiring uses
 * {@link SingleRepoIsolation}. Included now so Phase 2-4 do not bake
 * single-tenant assumptions into core.
 */
export class OrgProjectIsolation implements IsolationModel {
  constructor(private readonly baseDir: string = "artifacts/graphs") {}

  dbPath(ctx?: IsolationContext): string {
    const orgId = ctx?.orgId;
    const projectId = ctx?.projectId;
    if (!orgId || !projectId) {
      throw new Error(
        "OrgProjectIsolation requires both orgId and projectId in context",
      );
    }
    return join(this.baseDir, `org-${orgId}`, `project-${projectId}`, "graph.db");
  }

  /** Path to the shared, read-only public knowledge DB. */
  sharedDbPath(): string {
    return join(this.baseDir, "shared", "public-knowledge.db");
  }
}
