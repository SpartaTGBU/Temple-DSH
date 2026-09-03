---
description: "DSH 的可选 MemPalace build_graph 兼容图归一化和多跳探索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-mempalace-multipass

[English](README.md) | 中文

## 概述

`dsh-tool-mempalace-multipass` 注册一个可选工具 `mempalace_multipass_explore`，用于在本地探索 MemPalace palace 图。它接受与 MemPalace `palace_graph.build_graph()` 输出兼容的 JSON，可以是直接传入的 `{ nodes, edges }` 或 `[nodes, edges]`，也可以来自本地 JSON 文件。它验证输入，将输入归一化为稳定的类型化导出，派生有界多跳 room 路径，并返回与渲染器无关的 3D/graph 数据。它不实现通用 memory provider，不挖掘或搜索 drawers，也不执行 MemPalace 代码。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

只在需要 MemPalace 图探索的 composition 中加载此包。已发布的默认 bundles 不包含它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-tool-mempalace-multipass'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `10000` | 协作式 tool-call 超时预算，单位为毫秒 |
| `maxGraphBytes` | `5000000` | 通过 `graph_json_path` 提供的文件最大大小 |
| `maxRooms` | `500` | 一次调用接受的归一化 MemPalace rooms 最大数量 |
| `defaultMaxHops` | `2` | 调用提供 `start_room` 但不提供 `max_hops` 时使用的 BFS hop 深度 |

### 输入 JSON

该工具接受 MemPalace `palace_graph.build_graph()` 输出的 JSON 形式：

```json
{
  "nodes": {
    "auth": { "wings": ["project_a", "project_b"], "halls": ["design"], "count": 3, "dates": ["2026-09-01"] }
  },
  "edges": [
    { "room": "auth", "wing_a": "project_a", "wing_b": "project_b", "hall": "design", "count": 3 }
  ]
}
```

它也接受 `[nodes, edges]`，也就是 tuple 序列化为 JSON 后的形态。如果省略 `edges`，工具会从多 wing room nodes 派生 passive tunnel edges。这是 DSH 的归一化便利能力，不是对上游 MemPalace API 的声明。

### 本地探索工作流

调用 `mempalace_multipass_explore` 时必须且只能提供 `graph_json` 或 `graph_json_path` 之一。使用 `start_room` 和 `max_hops` 请求有界多跳 path 数据。文件路径模式只读取已经存在的本地 JSON 文件；它不会 shell out、导入 Python、启动 server、获取远程脚本或执行浏览器代码。

### 可视化数据

返回值的 `visualization` 字段包含可供本地渲染器使用的确定性 `nodes` 和 `links`。此包故意不捆绑浏览器资产：部署方可以用偏好的离线库或经过审查的 CDN import 渲染这个 DTO。CDN 资产能降低包大小，但可用性和脚本信任取决于配置的 origin；离线 vendored 资产会增加审查面和包大小，但保持本地执行。这个选择属于消费端 UI，而不是此 host tool。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

该工具把 MemPalace 集成保持在 graph export seam。MemPalace 拥有 mining、storage、traversal helpers 和 `build_graph()`。此包只拥有 DSH 侧验证、稳定排序、类型化导出名称、本地文件大小边界和 tool 生命周期。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis plugin、config schema、tool 注册、本地文件输入 |
| [`src/normalize.ts`](src/normalize.ts) | parser、validation、normalization、path 派生、visualization DTO |
| [`src/types.ts`](src/types.ts) | 稳定导出 interfaces 和 format marker |
| [`src/invariant.ts`](src/invariant.ts) | invariant companion |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [能力 seam](../../../docs/architecture.zh.md#capability-seams)——为什么集成是可选 tool package，而不是 loop patch。
- [Tool 编写参考](../../../docs/cookbook/adding-a-tool.zh.md)——tool schema、output 和 lifecycle contracts。
- MemPalace `mempalace/palace_graph.py` — `build_graph()` 返回字段的上游来源。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型可见内容

模型会看到生成的 [`mempalace_multipass_explore` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-mempalace-multipass)。它的 schema 要求且只允许 `graph_json` 或 `graph_json_path` 之一，并包含可选的 `start_room` 和 `max_hops`。描述文本说明该工具不会执行 MemPalace 或任意代码。

#### Token 影响

包被加载时有固定 schema 成本。调用会保留传入的 graph input path 或 inline JSON，以及归一化后的 JSON 结果，直到 compaction。

#### KV Cache 影响

只要工具定义和可见性不变，prefix 保持稳定。加载、卸载或改变包版本可能从 tool-schema section 开始使复用失效。

### 工具结果

#### 模型可见内容

成功结果是 JSON，包含 `format: "dsh.mempalace.multipass.graph.v1"`、归一化的 `rooms`、`tunnels`、`wings`、可选的 `paths`、`visualization` 和 `stats`。验证和文件失败会变成带有 `mempalace_multipass:` 消息的普通 tool errors。

#### Token 影响

数据相关，并由配置的 `maxRooms`、文件大小和 hop 深度限制。完整 JSON 结果像其他 tool output 一样被保留。

#### KV Cache 影响

Append-only；新可见的调用参数和结果跟在可复用 request prefix 后面。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了此包当前的集成 seam。

- **不执行实时 MemPalace 进程**——此包读取已经生成的 JSON 或直接 JSON。这避免任意代码执行，并让包独立于 Python 环境发现；但用户必须在 DSH 外部生成 `build_graph()` JSON。
- **不提供通用 memory provider**——此包不 mine、store、search 或 recall drawers。这些操作仍是 MemPalace 的职责，并且不在此分支范围内。
- **不捆绑浏览器渲染器**——此包只返回与渲染器无关的 3D/graph DTO。消费端 UI 必须选择经过审查的离线资产或明确的 CDN 策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

如果上游暴露经过审查的 MemPalace JSON command，未来 provider package 可以通过它获取 graphs。不要为了弥合这个缺口而向此工具加入任意 command execution。

</details>
