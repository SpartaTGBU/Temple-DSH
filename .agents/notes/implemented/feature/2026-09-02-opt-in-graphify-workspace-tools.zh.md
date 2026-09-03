# Agent Note: 可选 Graphify 工作区图工具

Status: implemented

[English](2026-09-02-opt-in-graphify-workspace-tools.md) | 中文

## Problem

代理可以用普通 shell 命令构建 Graphify 知识图，但该路径绕过 Harness 工具契约：模型负责拼接命令字符串，图路径不绑定到会话工作区，subprocess 取消依赖 shell，缺少 `graphify` 安装时只表现为通用命令失败。直接嵌入 Graphify 的 Python 包会让 Harness 为一个 Graphify 已经用维护良好的 CLI 暴露的功能拥有第二套运行时和导入边界。

## Decision

`@deepseek-ai/dsh-tool-graphify` 是可选的模型可见工具包。它通过 `ctx.tools` 注册 `graphify_index` 和 `graphify_query`，并用 argv 数组通过 `ctx.subprocess` 执行外部 CLI。已发布的基础 profile 默认不加载它；部署需要工作区图支持时，把此包加入 profile。

此包在解析 CLI 前验证会话工作区。相对路径基于 `agent.session.header.cwd` 或配置的 `workspaceRoot` 解析，realpath 到既有目录，并且必须保留在该根目录内。查询操作在内部构造 `<workspace>/graphify-out/graph.json`，从不接受模型提供的图路径。subprocess 环境设置 `GRAPHIFY_QUERY_LOG_DISABLE=1`，因此模型调用不会写入 Graphify 的可选明文查询日志。

CLI 保持外部依赖。`binaryPath` 默认是 `graphify`，`binaryArgs` 支持 `uvx --from graphifyy graphify` 等包装器，且不经过 shell 插值。缺少二进制会在 spawn 前失败并给出安装提示。超时和调用方取消通过 subprocess provider 中止已启动进程，收集到的 stdout/stderr 会与 exit、signal、timeout 和截断事实一起返回。

## Alternatives considered

**通过 MCP 挂载 Graphify。** Graphify 已提供 MCP server，Harness 也有 MCP client。此集成没有采用该路线，因为需要的核心操作包含 index/update 和 query，而 Graphify MCP 面主要面向图已经存在后的查询。直接工具还能让 Harness 在任何 Graphify 进程启动前强制工作区包含关系。

**使用现有 bash 或 pwsh 工具。** Shell 工具可以运行 `graphify`，但会让命令构造由模型拥有并经 shell 解析。这会失去确定性 argv 构造、配置化超时默认值、缺失二进制诊断，以及查询图路径停留在会话工作区下的保证。

**Vend 或导入 Graphify 作为 Python 库。** Graphify CLI 已经拥有其 Python 依赖、输出文件和命令行为。导入它会让 Harness 耦合到 Graphify 内部和 package extras；argv-only adapter 让集成保持小而清晰，并允许部署独立升级 Graphify。

## Consequences

此功能可以安全安装而不改变默认 profile；配置后的部署获得一个窄图工作流：构建/更新当前工作区图，然后对该图执行 query/explain/path。adapter 不把 Graphify 的 graph JSON 解析成 Harness 原生图类型；它保留 Graphify 的确定性 CLI 文本，并在旁边记录进程事实。大型初始索引仍是前台工具调用，可能需要更宽的部署超时或在代理外运行 Graphify。

已提交的检查固定此边界：单元测试覆盖包含关系、argv 顺序、包装器参数、缺失二进制、缺失图、查询标志、非零退出和确定性文本渲染；Loader smoke 通过 app-boot 启动此包并使用假的 argv-only CLI；invariant companion 验证实时 Graphify 工具结果记录。
