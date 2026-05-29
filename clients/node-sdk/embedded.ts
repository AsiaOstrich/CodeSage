import { GraphConnection } from "../../src/graph-db/connection.js";
import { initSchema } from "../../src/graph-db/schema.js";
import {
  SingleRepoIsolation,
  type IsolationModel,
  type IsolationContext,
} from "../../src/adapters/isolation.js";
import type { GraphRow } from "../../src/graph-db/types.js";
import type { KuzuValue } from "kuzu";

/**
 * In-process CodeSage client: zero HTTP overhead.
 *
 * Wraps {@link GraphConnection} directly so consumers (e.g. VibeOps
 * `src/platform/memory/structural/`, Phase 6) can embed the graph engine in
 * the same process. The isolation model decides the on-disk DB path; the
 * default is single-repo.
 */
export class EmbeddedClient {
  private conn: GraphConnection | null = null;

  constructor(
    private readonly isolation: IsolationModel = new SingleRepoIsolation(),
    private readonly ctx?: IsolationContext,
  ) {}

  /** Open the underlying DB and ensure the schema exists. Idempotent. */
  async init(): Promise<void> {
    if (this.conn) {
      return;
    }
    this.conn = GraphConnection.open(this.isolation.dbPath(this.ctx));
    await initSchema(this.conn);
  }

  /** Run a Cypher query against the embedded graph. */
  async query(
    cypher: string,
    params?: Record<string, KuzuValue>,
  ): Promise<GraphRow[]> {
    if (!this.conn) {
      await this.init();
    }
    return this.conn!.query(cypher, params);
  }

  /** Close the embedded connection. */
  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }
}
