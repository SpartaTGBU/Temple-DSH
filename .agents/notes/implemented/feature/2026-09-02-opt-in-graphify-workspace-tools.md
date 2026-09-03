# Agent Note: Opt-in Graphify workspace graph tools

Status: implemented

English | [中文](2026-09-02-opt-in-graphify-workspace-tools.zh.md)

## Problem

Agents can build a Graphify knowledge graph by using an ordinary shell command, but that path bypasses Harness tool contracts: the model assembles command strings, graph paths are not tied to the session workspace, subprocess cancellation is shell-dependent, and missing `graphify` installations surface as generic command failures. Directly embedding Graphify's Python package would make Harness own a second runtime and import boundary for a feature that Graphify already exposes as a maintained CLI.

## Decision

`@deepseek-ai/dsh-tool-graphify` is an opt-in model-facing tool package. It registers `graphify_index` and `graphify_query` through `ctx.tools`, and executes the external CLI through `ctx.subprocess` with argv arrays. No shipped base profile loads it by default; a deployment adds the package to a profile when it wants workspace graph support.

The package validates the session workspace before resolving the CLI. Relative paths resolve against `agent.session.header.cwd` or configured `workspaceRoot`, realpath to an existing directory, and must remain inside that root. Query operations construct `<workspace>/graphify-out/graph.json` internally and never accept a model-provided graph path. The subprocess environment sets `GRAPHIFY_QUERY_LOG_DISABLE=1` so model calls do not write Graphify's optional plaintext query log.

The CLI remains external. `binaryPath` defaults to `graphify`, and `binaryArgs` supports wrappers such as `uvx --from graphifyy graphify` without shell interpolation. Missing binaries fail before spawn with an install hint. Timeouts and caller cancellation abort the spawned process through the subprocess provider, and collected stdout/stderr are returned with exit, signal, timeout, and truncation facts.

## Alternatives considered

**Mount Graphify through MCP.** Graphify already offers an MCP server, and Harness has an MCP client. That route was rejected for this integration because the requested core operations include index/update as well as query, while the Graphify MCP surface is primarily query-oriented once a graph exists. A direct tool also lets Harness enforce workspace containment before any Graphify process starts.

**Use the existing bash or pwsh tool.** Shell tools can run `graphify`, but they make command construction model-owned and shell-parsed. That loses deterministic argv construction, configured timeout defaults, missing-binary diagnostics, and the guarantee that query graph paths stay under the session workspace.

**Vendor or import Graphify as a Python library.** Graphify's CLI already owns its Python dependencies, output files, and command behavior. Importing it would couple Harness to Graphify internals and package extras, while an argv-only adapter keeps the integration small and lets deployments upgrade Graphify independently.

## Consequences

The feature is safe to install without changing default profiles, and a configured deployment gets a narrow graph workflow: build/update the current workspace graph, then query/explain/path against that graph. The adapter does not parse Graphify's graph JSON into a Harness-native graph type; it preserves Graphify's deterministic CLI text and records process facts beside it. Large initial indexes remain foreground tool calls and may need a wider deployment timeout or an out-of-agent Graphify run.

The shipped checks pin the boundary: unit tests cover containment, argv ordering, wrapper arguments, missing binaries, missing graphs, query flags, non-zero exits, and deterministic text rendering; a Loader smoke boots the package through app-boot with a fake argv-only CLI; the invariant companion validates live Graphify tool-result records.
