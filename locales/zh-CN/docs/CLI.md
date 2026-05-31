---
source: docs/CLI.md
source_version: 0.2.0
translation_version: 0.2.0
last_synced: 2026-05-30
status: complete
---

# EngramGraph CLI

> **语言：** [English](../../../docs/CLI.md) · [繁體中文](../../zh-TW/docs/CLI.md) · 简体中文

`egr` CLI 会把一个 repo 索引进图谱，并可从 shell 或 CI 查询它。它是 library 与
MCP server 共用的同一批已测函数之上的薄层——无 LLM、确定性。

```
egr <command> [args] [options]
```

## 图数据库位置

每个命令都读写同一个 Kuzu 数据库，路径按以下优先级解析（XSPEC-245）：

1. 环境变量 `ENGRAM_DB`（完整路径，最高），否则
2. `--graph <name>` → `./.engram/<name>.db`，否则
3. `--isolation git-branch`（或环境变量 `ENGRAM_ISOLATION=git-branch`）→ 每分支一个
   `<git-common-dir>/engram/<branch>.db`，否则
4. 默认单一 `./.engram/graph.db`。

目录会按需创建，且每次打开都会确保 schema 存在（幂等），因此首次 `index` 也能在空 repo 上运行。
见下方[分支 / 项目隔离](#分支--项目隔离)。

## 全局选项

| 选项 | 说明 |
|------|------|
| `--json` | 输出原始 JSON，而非人类可读摘要 |
| `--graph <name>` | 使用 `./.engram/<name>.db`——显式命名的项目图谱 |
| `--isolation <mode>` | `single`（默认）或 `git-branch`（每分支一张图）|
| `-h`、`--help` | 显示用法 |
| `-v`、`--version` | 显示包版本 |

## 命令

### `index <dir> [--docs] [--clean]`

递归将 `<dir>` 下的源代码索引进**代码图谱**（tree-sitter → `Function` / `Class` /
`Module` 节点 + 跨文件 `CALLS`）。加上 `--docs` 时，也会把 `*.md` 索引进**知识图谱**
（front-matter → `Spec` / `Decision` + `IMPACTS` / `SUPERSEDES`）。

- 代码扩展名：`.ts .tsx .js .jsx .mts .cts .mjs .cjs`（排除 `.d.ts`）。
- 跳过的目录：`node_modules`、`dist`、`.engram`、`.git`、`coverage`。
- `--clean`：索引前先清空图谱数据。索引本是 upsert（MERGE）从不删除，代码里被移除的节点
  会残留；`--clean` 从头重建以清掉它。

```bash
egr index ./src
egr index . --docs
egr index ./src --clean   # 重建，清掉已删除的节点
```

输出计数：`files`、`functions`、`classes`、`calls`，以及 `ambiguous`（被调用名称匹配到
> 1 个函数——跳过）与 `unresolved`（匹配不到——跳过）；加上 `--docs` 时还有
`specs` / `decisions` / `impacts` / `supersedes`。

### `callers <symbol> [--depth N]`

（可传递，最多到 `--depth`，默认 1）调用 `<symbol>` 的函数。“改这个会牵动什么？”

```bash
egr callers callChain --depth 2
```

### `callees <symbol> [--depth N]`

`<symbol>`（可传递，最多到 `--depth`，默认 1）所调用的函数。

```bash
egr callees createMcpServer
```

> `--depth` 会被夹到 `1..10`。符号以**名称**匹配；若名称在多个文件中重复使用，所有匹配项都会被纳入。

### `impact <spec-id> [--max-hops N]`

某个 spec 的影响链中的决策——哪些 `Decision` 节点通过直接的 `IMPACTS` 边，加上多跳
`SUPERSEDES` 链（`--max-hops`，默认 3，夹到 `1..10`），影响此 `Spec`。

```bash
egr impact XSPEC-237
egr impact XSPEC-237 --max-hops 5 --json
```

每条结果显示决策 `id`、抵达方式（`direct` | `supersedes`）与其 `title`。

### `feedback <type> <node-id> [--label L]`

按一个反馈事件演化某节点的 SAGE 置信度。

- `<type>`：`test_fail`（负向、权重 1.0）、`test_pass`（正向、0.4）、
  `human_fix`（正向、0.6）、`status_change`（中性）。
- `--label`：`Function`（默认）| `Spec` | `Decision` | `Doc`。
- 节点以 **id** 匹配（`Decision` / `Spec` 的 id 例如 `DEC-1` / `XSPEC-1`；
  `Function` 则是作用域限定的 id，如 `src/a.ts#a`）。

```bash
egr feedback test_fail "src/api/server.ts#createServer"
egr feedback human_fix DEC-070 --label Decision
```

打印 `before → after`，若 id/label 未命中则打印 "node not found"。

### `top <label> [--limit N]`

某标签下置信度最高的节点，按置信度递减。

- `<label>`：`Function` | `Spec` | `Decision` | `Doc`。
- `--limit`：默认 10，夹到 `1..1000`。

```bash
egr top Function --limit 20
egr top Decision --json
```

### `gc [--dry-run]`

回收已不存在分支的 per-branch 图谱。检查 `<git-common-dir>/engram/`；当没有任何现存
本地分支对应到 `<name>` 时，`<name>.db` 即为孤儿。`--dry-run` 只列不删。非 git repo 时为 no-op。

```bash
egr gc --dry-run
egr gc
```

### `serve [--port 3000]`

在图数据库上运行 REST server（Hono）。路由挂载于 `/graph/*` 加上 `GET /health`。
长时间运行——自行管理生命周期。路由接口见 [API.md](./API.md)。

```bash
egr serve --port 3000
```

### `mcp`

以 stdio 运行 MCP server 供编程助手使用，与 `egr-mcp` bin 相同。长时间运行。
助手配置见 [MCP.md](./MCP.md)。

```bash
egr mcp
```

## 分支 / 项目隔离

默认所有命令共用同一个 `./.engram/graph.db`。由于 `.engram/` 被 gitignore 且待在工作树，
**`git checkout` 不会换掉它**——不同分支共用同一张图。三种隔离方式：

1. **`--isolation git-branch`**（或在 shell 设一次 `ENGRAM_ISOLATION=git-branch`）：每个分支
   各自 `<git-common-dir>/engram/<branch>.db`，切分支后仍在、不污染工作树。分支名会加 hash
   后缀消毒，故 `feature/x` 与 `feature-x` 永不冲突。用 `egr gc` 回收已删分支的图。
2. **`--graph <name>`**：显式、与 git 无关的项目图——适合 detached HEAD 或分支命名随意时。
3. **`git worktree`**：每个分支各自 checkout 到独立目录，天然各有 `./.engram/graph.db`——
   零旗标、最干净,当分支对应长期独立项目时最合适。

> **MCP 注意**：MCP server 在启动时绑定一张图（路径记到 stderr），**不会**跟着之后的
> `git checkout`——要切换需重连/重启 server（或启动时带 `--graph` / `ENGRAM_ISOLATION`）。

## CI 示例

```bash
export ENGRAM_DB="$PWD/.engram/graph.db"
egr index ./src --docs
# 例如：当高风险符号出现新的调用者时让 job 失败，用 --json 查询等。
egr callers paymentGateway --depth 3 --json > callers.json
```

## 退出码

成功为 `0`；错误为 `1`（消息以 `egr: <message>` 写到 stderr）。
