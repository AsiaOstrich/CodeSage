# CodeSage CLI

> **Language:** English · [繁體中文](../locales/zh-TW/docs/CLI.md) · [简体中文](../locales/zh-CN/docs/CLI.md)

The `codesage` CLI indexes a repository into the graph and queries it from the
shell or CI. It is a thin layer over the same tested functions the library and
MCP server use — zero LLM, deterministic.

```
codesage <command> [args] [options]
```

## Graph DB location

Every command reads/writes one Kuzu database. Its path is resolved in this
priority order (XSPEC-245):

1. env `CODESAGE_DB` (a full path; highest), else
2. `--graph <name>` → `./.codesage/<name>.db`, else
3. `--isolation git-branch` (or env `CODESAGE_ISOLATION=git-branch`) → a
   per-branch DB `<git-common-dir>/codesage/<branch>.db`, else
4. the default single `./.codesage/graph.db`.

The directory is created on demand and the schema is ensured on every open
(idempotent), so the first `index` works against an empty repo. See
[Branch / project isolation](#branch--project-isolation) below.

## Global options

| Option | Description |
|--------|-------------|
| `--json` | Emit raw JSON instead of the human-readable summary |
| `--graph <name>` | Use `./.codesage/<name>.db` — an explicitly named project graph |
| `--isolation <mode>` | `single` (default) or `git-branch` (one graph per branch) |
| `-h`, `--help` | Show usage |
| `-v`, `--version` | Show the package version |

## Commands

### `index <dir> [--docs] [--clean]`

Recursively indexes source files under `<dir>` into the **code graph**
(tree-sitter → `Function` / `Class` / `Module` nodes + cross-file `CALLS`).
With `--docs`, also indexes `*.md` files into the **knowledge graph**
(front-matter → `Spec` / `Decision` + `IMPACTS` / `SUPERSEDES`).

- Code extensions: `.ts .tsx .js .jsx .mts .cts .mjs .cjs` (`.d.ts` excluded).
- Skipped directories: `node_modules`, `dist`, `.codesage`, `.git`, `coverage`.
- `--clean`: drop the graph's data before indexing. Indexing is otherwise an
  upsert (MERGE) that never deletes, so a node removed from the code lingers;
  `--clean` rebuilds from scratch to prune it.

```bash
codesage index ./src
codesage index . --docs
codesage index ./src --clean   # rebuild, pruning deleted nodes
```

Output counts: `files`, `functions`, `classes`, `calls`, plus `ambiguous`
(callee name matched > 1 function — skipped) and `unresolved` (callee matched
none — skipped); with `--docs`, `specs` / `decisions` / `impacts` / `supersedes`.

### `callers <symbol> [--depth N]`

Functions that (transitively, up to `--depth`, default 1) call `<symbol>`.
"What breaks if I change this?"

```bash
codesage callers callChain --depth 2
```

### `callees <symbol> [--depth N]`

Functions that `<symbol>` (transitively, up to `--depth`, default 1) calls.

```bash
codesage callees createMcpServer
```

> `--depth` is clamped to `1..10`. A symbol is matched by **name**; if a name is
> reused across files, all matches are considered.

### `impact <spec-id> [--max-hops N]`

Decisions in the impact chain of a spec — which `Decision` nodes affect this
`Spec`, via the direct `IMPACTS` edge plus a multi-hop `SUPERSEDES` chain
(`--max-hops`, default 3, clamped to `1..10`).

```bash
codesage impact XSPEC-237
codesage impact XSPEC-237 --max-hops 5 --json
```

Each result row shows the decision `id`, how it was reached (`direct` |
`supersedes`), and its `title`.

### `feedback <type> <node-id> [--label L]`

Evolve a node's SAGE confidence from one feedback event.

- `<type>`: `test_fail` (negative, weight 1.0), `test_pass` (positive, 0.4),
  `human_fix` (positive, 0.6), `status_change` (neutral).
- `--label`: `Function` (default) | `Spec` | `Decision` | `Doc`.
- The node is matched by **id** (for `Decision` / `Spec` the id is e.g.
  `DEC-1` / `XSPEC-1`; for `Function` it is the scope-qualified id such as
  `src/a.ts#a`).

```bash
codesage feedback test_fail "src/api/server.ts#createServer"
codesage feedback human_fix DEC-070 --label Decision
```

Prints `before → after`, or "node not found" if the id/label miss.

### `top <label> [--limit N]`

Highest-confidence nodes of a label, confidence-descending.

- `<label>`: `Function` | `Spec` | `Decision` | `Doc`.
- `--limit`: default 10, clamped to `1..1000`.

```bash
codesage top Function --limit 20
codesage top Decision --json
```

### `gc [--dry-run]`

Garbage-collect per-branch graphs whose branch no longer exists. Inspects
`<git-common-dir>/codesage/`; a `<name>.db` is an orphan when no current local
branch maps to `<name>`. `--dry-run` lists without deleting. No-op outside a git
repo.

```bash
codesage gc --dry-run
codesage gc
```

### `serve [--port 3000]`

Run the REST server (Hono) over the graph DB. Routes are mounted under
`/graph/*` plus `GET /health`. Long-running — manages its own lifecycle.
See [API.md](./API.md) for the route surface.

```bash
codesage serve --port 3000
```

### `mcp`

Run the MCP server over stdio for coding assistants. Identical to the
`codesage-mcp` bin. Long-running. See [MCP.md](./MCP.md) for assistant setup.

```bash
codesage mcp
```

## Branch / project isolation

By default all commands share one `./.codesage/graph.db`. Because `.codesage/`
is gitignored and lives in the work tree, **`git checkout` does not swap it** —
different branches share the same graph. Three ways to isolate:

1. **`--isolation git-branch`** (or set `CODESAGE_ISOLATION=git-branch` once in
   your shell): each branch gets its own `<git-common-dir>/codesage/<branch>.db`,
   which survives checkouts and never pollutes the work tree. Branch names are
   sanitized with a hash suffix so `feature/x` and `feature-x` never collide.
   Use `codesage gc` to reclaim graphs of deleted branches.
2. **`--graph <name>`**: an explicit, git-independent project graph — handy for
   a detached HEAD or when branch names are ad-hoc.
3. **`git worktree`**: each branch checked out in its own directory naturally
   gets its own `./.codesage/graph.db` — zero flags, the cleanest isolation when
   branches map to long-lived separate projects.

> **MCP caveat**: the MCP server binds to one graph at startup (it logs the path
> to stderr). It does **not** follow a later `git checkout` — reconnect/restart
> the server (or launch it with `--graph` / `CODESAGE_ISOLATION`) to switch.

## CI example

```bash
export CODESAGE_DB="$PWD/.codesage/graph.db"
codesage index ./src --docs
# Fail the job if a high-risk symbol gained new callers, query with --json, etc.
codesage callers paymentGateway --depth 3 --json > callers.json
```

## Exit codes

`0` on success; `1` on error (the message is written to stderr as
`codesage: <message>`).
