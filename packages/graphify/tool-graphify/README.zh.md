---
description: "可选的模型可见 Graphify 工具，供代理通过已安装的 graphify CLI 构建、更新或查询工作区知识图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-graphify

[English](README.md) | 中文

## 概述

`dsh-tool-graphify` 注册 `graphify_index` 和 `graphify_query`。这些工具通过 `ctx.subprocess` 调用外部 `graphify` 可执行文件，绝不经过 shell，因此 Graphify 仍是可选 Python CLI，而 Harness 负责 argv 构造、取消和输出解析。插件解析调用方会话工作区，拒绝工作区外路径，为工具调用关闭 Graphify 查询日志，并在缺少二进制时给出安装提示。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

只在允许代理维护工作区 Graphify 图的 profile 中加载此包。宿主必须安装 Graphify CLI（`uv tool install graphifyy`、`pipx install graphifyy`，或在配置中给出绝对二进制路径）。插件需要 `dsh-tools` 和一个 subprocess provider，例如 `dsh-subprocess-local`。

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-tool-graphify'
  config:
    binaryPath: graphify
    timeoutMs: 120000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `binaryPath` | `graphify` | Graphify CLI 的 PATH 命令或绝对可执行路径 |
| `binaryArgs` | `[]` | 插入在 Graphify 操作前的固定参数，用于 `uvx --from graphifyy graphify` 等包装器 |
| `workspaceRoot` | 会话 cwd，然后 process cwd | 非代理调用工具时使用的后备根目录 |
| `timeoutMs` | `120000` | 每次 CLI 调用的默认超时 |
| `maxTimeoutMs` | `600000` | 模型传入 `timeoutMs` 的上限 |
| `maxOutputBytes` | `128000` | 每个 stdout/stderr 流保留的字节数 |
| `graceMs` | `3000` | 取消后进程树终止宽限期 |

`graphify_index` 接受 `operation: "index" | "update"`。`index` 默认运行 `graphify extract <path> --out <workspace> --code-only --no-cluster`，通过本地 AST 抽取生成工作区的 `graphify-out/graph.json`，不调用 LLM 或执行聚类。只有当部署明确选择这些 Graphify 行为时，才设置 `code_only: false` 或 `no_cluster: false`。自定义 `path` 可缩小初始扫描范围，而 `--out` 仍使图归工作区所有。`update` 始终运行 `graphify update <workspace>` 并拒绝 `path`，因为 Graphify 相对于扫描根查找更新图。

`graphify_query` 接受 `operation: "query" | "explain" | "path"`。它总是读取 `<workspace>/graphify-out/graph.json`；调用者不能指向另一个图。`query` 需要 `question`，并接受可选 `budget`、`dfs` 和重复的 `context` 过滤器。`explain` 需要 `node`。`path` 需要 `source` 和 `target`。

### 可能出错的情况

缺少 CLI 时返回 `graphify CLI unavailable. Install the PyPI package 'graphifyy' or set tool-graphify.binaryPath.`，且不会转发宿主解析器细节。工作区外路径会在解析二进制前被拒绝。索引还会拒绝规范目标逃逸工作区的既有 `graphify-out` 目录或图符号链接，同时允许 Graphify 创建缺失的工作区内输出。查询操作要求图是工作区内的普通可读文件；缺失时先运行 `graphify_index`。Graphify 非零退出会作为工具成功结果返回，并携带有界 stdout、有界 stderr、signal、timeout 和 exit-code 字段，供代理检查 CLI 自身诊断。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

插件是 subprocess seam 之上的模型可见 Consumer。它通过 `ctx.subprocess.resolveExecutable` 解析 `binaryPath`，用 argv 数组启动进程，`stdin: ignore`，并在固定字节上限下收集 stdout/stderr。subprocess provider 会删除名称形似凭据的环境变量；插件只显式传入 `GRAPHIFY_QUERY_LOG_DISABLE=1`，避免模型调用写入明文查询日志。正常完成、超时或取消后，它会等待整个进程树退出再发布结果。

工作区包含关系使用规范路径检查。相对路径基于会话 cwd 或配置的 `workspaceRoot` 解析；绝对路径以及符号链接或 junction 的目标仍必须 realpath 到该根目录下。查询操作在内部构造并规范化 `graphify-out/graph.json`，要求它是普通可读文件，并且从不接受模型提供的图路径。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具注册、配置验证、工作区包含检查、argv 构造、subprocess 执行和渲染 |
| [`src/invariant.ts`](src/invariant.ts) | Graphify 工具结果记录的运行时 invariant companion |
| [`tests/tool-graphify.spec.ts`](tests/tool-graphify.spec.ts) | 使用假 subprocess provider 的聚焦行为覆盖 |
| [`tests/invariant.spec.ts`](tests/invariant.spec.ts) | 对一致和不一致工具结果的 invariant 覆盖 |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | 使用 argv-only 假 CLI 的真实 Loader 组合 smoke |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Graphify 包地图](../README.zh.md) — 可选 Graphify 家族。
- [Subprocess 能力](../../subprocess/subprocess/README.zh.md) — 可执行文件解析、启动进程生命周期和收集输出。
- [工具子系统](../../../docs/subsystems/tools.zh.md) — 工具注册、执行、结果归一化和取消。
- [Graphify README](https://github.com/Graphify-Labs/graphify#readme) — 外部 CLI 安装和命令参考。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到用于 `index` 和 `update` 的 `graphify_index`，以及用于 `query`、`explain` 和 `path` 的 `graphify_query`；生成的 [`@deepseek-ai/dsh-tool-graphify` catalog 条目](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-graphify)携带完整 schema。schema 文本说明路径限制在工作区内，查询读取当前工作区图。

#### Token 影响

插件启用时产生固定 schema 成本。插件不贡献 system-prompt section。

#### KV Cache 影响

只要工具可见性和依赖配置的 schema 文本不变，请求前缀保持稳定。

### 工具结果

#### 模型看到什么

CLI 成功退出时渲染换行已规范化且去除尾随空白的 stdout；stdout 为空时渲染 `<operation> completed.`。CLI 失败退出时渲染 `graphify <operation> failed.`、stdout、存在时的 `[stderr]` 段、截断标记以及 timeout/signal/exit 标记。规范 JSON 值还携带 argv tail、工作区根、目标或图路径、有界 stdout/stderr 和进程结果字段；模型看不到收集器的私有溢出路径或可执行文件解析诊断。

#### Token 影响

调用前没有结果 token。输出 token 由数据决定，并受每个流 `maxOutputBytes` 限制。

#### KV Cache 影响

追加式；返回文本位于可复用请求前缀之后，不会使先前 KV-cache 条目失效。

### 工具错误

#### 模型看到什么

验证、工作区逃逸、缺少图、缺少二进制和启动前取消通过普通工具失败路径返回 `Error: <message>`。

#### Token 影响

只有失败调用会增加这些保留 token。

#### KV Cache 影响

追加式；错误位于可复用请求前缀之后。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明此可选工具何时不适合，或何时需要部署侧处理。

- **Graphify 仍是外部 CLI** — 此包不会 vend 或安装 `graphifyy`；部署必须安装它并保持其 Python 环境可用。
- **不会转发环境凭据** — 除非部署用单独配置的可执行包装器调用 Graphify，否则 `code_only: false` 只能使用无需凭据的 Graphify backend。
- **索引只以前台方式运行** — 大型工作区可能触发工具超时；初始抽取过重时，配置更大的超时或在代理外运行 Graphify。
- **图查询输出是纯文本** — 此包保留 Graphify 的确定性 CLI 文本，而不是重新解析节点和边为 Harness 原生图结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
