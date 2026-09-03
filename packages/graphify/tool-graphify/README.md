---
description: "The opt-in model-facing Graphify tools for agents that need to build, update, or query a workspace knowledge graph through the installed graphify CLI."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-graphify

English | [中文](README.zh.md)

## Summary

`dsh-tool-graphify` registers `graphify_index` and `graphify_query`. The tools call the external `graphify` executable through `ctx.subprocess`, never through a shell, so Graphify stays an optional Python CLI and Harness controls argv construction, cancellation, and output parsing. The plugin resolves the owning session workspace, rejects paths outside it, disables Graphify query logging for tool calls, and reports missing binaries with an install hint.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this package only in profiles where the agent may maintain a Graphify graph for its workspace. The host must have the Graphify CLI installed (`uv tool install graphifyy`, `pipx install graphifyy`, or an absolute binary path in config). The plugin needs `dsh-tools` and a subprocess provider such as `dsh-subprocess-local`.

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-tool-graphify'
  config:
    binaryPath: graphify
    timeoutMs: 120000
```

| Field | Default | Meaning |
|---|---|---|
| `binaryPath` | `graphify` | Bare PATH command or absolute executable path for the Graphify CLI |
| `binaryArgs` | `[]` | Fixed arguments inserted before the Graphify operation, for wrappers such as `uvx --from graphifyy graphify` |
| `workspaceRoot` | session cwd, then process cwd | Fallback root when a non-agent caller invokes the tool |
| `timeoutMs` | `120000` | Default per-call CLI timeout |
| `maxTimeoutMs` | `600000` | Cap for model-supplied `timeoutMs` |
| `maxOutputBytes` | `128000` | Per-stream retained stdout/stderr bytes |
| `graceMs` | `3000` | Process-tree termination grace after cancellation |

`graphify_index` accepts `operation: "index" | "update"`. `index` runs `graphify extract <path> --out <workspace> --code-only --no-cluster` by default, producing the workspace's `graphify-out/graph.json` with local AST extraction and without LLM calls or clustering. Set `code_only: false` or `no_cluster: false` only when the deployment has chosen those Graphify behaviors. A custom `path` may narrow the initial scan while `--out` keeps the graph workspace-owned. `update` always runs `graphify update <workspace>` and rejects `path`, because Graphify discovers its update graph relative to the scan root.

`graphify_query` accepts `operation: "query" | "explain" | "path"`. It always reads `<workspace>/graphify-out/graph.json`; callers cannot point it at another graph. `query` takes `question`, optional `budget`, `dfs`, and repeated `context` filters. `explain` takes `node`. `path` takes `source` and `target`.

### What can go wrong

A missing CLI returns `graphify CLI unavailable. Install the PyPI package 'graphifyy' or set tool-graphify.binaryPath.` without forwarding host resolver details. Paths outside the session workspace are rejected before the binary is resolved. Indexing also rejects an existing `graphify-out` directory or graph symlink whose canonical target escapes the workspace, while allowing Graphify to create a missing contained output. Query operations require a regular, readable contained graph; run `graphify_index` first when it is missing. Non-zero Graphify exits are returned as tool successes with bounded stdout, bounded stderr, signal, timeout, and exit-code fields so the agent can inspect the CLI's own diagnostic.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a model-facing Consumer over the subprocess seam. It resolves `binaryPath` through `ctx.subprocess.resolveExecutable`, spawns an argv array with `stdin: ignore`, and collects stdout/stderr under fixed byte caps. The subprocess provider removes credential-shaped ambient variables; the plugin explicitly passes only `GRAPHIFY_QUERY_LOG_DISABLE=1` to avoid writing a plaintext query log from model calls. It awaits whole-tree exit before publishing an outcome after normal completion, timeout, or cancellation.

Workspace containment is checked with canonical paths. Relative paths resolve against the session cwd or configured `workspaceRoot`; absolute paths and symlink or junction targets must still realpath under that root. Query operations construct and canonicalize `graphify-out/graph.json`, require a regular readable file, and never accept a model-provided graph path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool registration, config validation, workspace containment, argv construction, subprocess execution, and rendering |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant companion for Graphify tool-result records |
| [`tests/tool-graphify.spec.ts`](tests/tool-graphify.spec.ts) | Focused behavior coverage with a fake subprocess provider |
| [`tests/invariant.spec.ts`](tests/invariant.spec.ts) | Invariant coverage for coherent and incoherent tool results |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | Real Loader composition smoke with an argv-only fake CLI |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Graphify package map](../README.md) — the opt-in Graphify family.
- [Subprocess capability](../../subprocess/subprocess/README.md) — executable resolution, spawned process lifetimes, and collected output.
- [Tool subsystem](../../../docs/subsystems/tools.md) — tool registration, execution, result normalization, and cancellation.
- [Graphify README](https://github.com/Graphify-Labs/graphify#readme) — external CLI install and command reference.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees `graphify_index` for `index` and `update`, and `graphify_query` for `query`, `explain`, and `path`; the generated [`@deepseek-ai/dsh-tool-graphify` catalog entry](../../../docs/tool-catalog.md#deepseek-aidsh-tool-graphify) carries the complete schemas. The schema text tells it that paths are workspace-contained and that query reads the current workspace graph.

#### Token effect

Fixed schema cost while the plugin is active. The plugin contributes no system-prompt section.

#### KV Cache effect

Prefix-stable while the tool visibility and config-dependent schema text are unchanged.

### Tool results

#### What the model sees

Successful CLI exits render newline-normalized stdout with trailing whitespace removed, or `<operation> completed.` when stdout is empty. Failed CLI exits render `graphify <operation> failed.`, stdout, a `[stderr]` section when present, truncation markers, and timeout/signal/exit markers. The canonical JSON value also carries the argv tail, workspace root, target or graph path, bounded stdout/stderr, and process outcome fields; private collector spill paths and executable-resolution diagnostics are not model-visible.

#### Token effect

Zero result tokens before a call. Output tokens are data-dependent and bounded by `maxOutputBytes` per stream.

#### KV Cache effect

Append-only; returned text follows the reusable request prefix and does not invalidate earlier KV-cache entries.

### Tool errors

#### What the model sees

Validation, workspace escape, missing graph, missing binary, and pre-spawn cancellation return `Error: <message>` through the normal tool failure path.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; the error follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the opt-in tool is a poor fit or needs deployment care.

- **Graphify remains an external CLI** — the package does not vendor or install `graphifyy`; deployments must install it and keep its Python environment healthy.
- **Ambient credentials are not forwarded** — `code_only: false` can use only a credential-free Graphify backend unless a deployment wraps Graphify in a separately configured executable.
- **Indexing is foreground-only** — large workspaces can hit the tool timeout; use a wider configured timeout or run Graphify outside the agent when initial extraction is too expensive.
- **Graph query output is plain text** — the package preserves Graphify's deterministic CLI text instead of re-parsing nodes and edges into a Harness-native graph result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
