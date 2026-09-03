---
description: "Graphify integration packages for opt-in workspace graph indexing and query through the Harness tool registry."
kind: "package-group"
---

# Graphify packages

English | [中文](README.zh.md)

## Summary

Graphify packages expose the external `graphify` CLI to agents through ordinary Harness plugin composition. The family is opt-in: no shipped base profile loads it by default, and each plugin keeps Graphify's Python package outside the Harness runtime.

## Packages

| Package | Role |
|---|---|
| [`tool-graphify`](tool-graphify/README.md) | Model-facing `graphify_index` and `graphify_query` tools over `ctx.subprocess` |

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
