# Agent Note: MemPalace multipass graph seam

Status: implemented

[English](2026-09-02-mempalace-multipass-graph-seam.md) | 中文

## Problem

MemPalace 通过 `palace_graph.build_graph()`、`traverse()` 和 tunnel helpers 暴露 palace navigation，但 DSH 需要一个可选集成来探索该 graph，同时不能变成第二个 memory provider，也不能执行任意本地代码。宽泛的 dashboard 或 provider 会把 mining、recall、storage 和 visualization concerns 混进一个包，并夸大上游 MemPalace 当前作为稳定 DSH service 暴露的能力。

## Decision

DSH 发布 `@deepseek-ai/dsh-tool-mempalace-multipass` 作为 model-facing 可选 tool package。该包接受 MemPalace `build_graph()` JSON，形式可以是 `{ nodes, edges }`、`[nodes, edges]`，或已经写入的本地 JSON 文件；它在 file/tool boundary 验证输入，并归一化为 `dsh.mempalace.multipass.graph.v1`。导出包含排序后的 room、wing、tunnel、有界 path 和与渲染器无关的 visualization DTO。该工具不运行 MemPalace，不导入 Python，不启动 local service，不获取 browser assets，也不执行 graph scripts。

## Integration seam

Seam 是 graph export，不是 memory storage。MemPalace 继续拥有 mining、palace persistence、drawer recall、hallway/tunnel construction 和 Python traversal helpers。DSH 只拥有本地 JSON ingestion、稳定 TypeScript DTO、tool lifecycle，以及未来 UI 可以渲染的确定性 visualization hints。文件 ingestion 仅限 JSON 且有大小边界，所以想读取 live MemPalace state 的调用方必须先在此包外通过经过审查的 workflow 生成 JSON。

## Alternatives considered

**General memory provider** — 拒绝，因为此分支范围限定为 multi-hop palace exploration 和 graph visualization。Provider 需要 storage、recall、durability、privacy 和 model-context contracts，范围大于当前可用的上游 graph seam。

**Maintenance dashboard** — 拒绝，因为 status、repair、mining 和 dashboard workflows 属于另一个 MemPalace 集成。把它们加在这里会让 graph exploration package 装载超过自身所需的 authority。

**Run a configurable MemPalace command** — 拒绝用于此包，因为任意 command execution 会产生本地 code-execution surface，并且需要 Python environment discovery。如果上游发布 JSON graph export command，未来 provider 可以加入经过审查的固定 command。

**Bundle a browser renderer** — 拒绝，因为 host package 可以暴露 renderer-neutral DTO，而不必选择 CDN 或 vendored JavaScript asset。消费端 UI 拥有该 tradeoff，并可应用自己的 script review policy。

## Consequences

该集成可安全地本地 compose，也易于移除：disposing plugin 会 unregister tool，且不留下 background service。代价是用户或另一个可信包必须先生成 `build_graph()` JSON，DSH 才能探索它。测试固定 graph normalization、isolated wings and rooms、tunnel and path derivation、invalid input rejection、file ingestion 和 registry cleanup。
