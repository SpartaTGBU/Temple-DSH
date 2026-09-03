# Agent Note: Opt-in MemPalace dashboard projection

Status: implemented

English | [中文](2026-09-02-opt-in-mempalace-dashboard-projection.zh.md)

## Problem

MemPalace stores user memory in a hierarchy of wings, rooms, drawers, tunnels, diary-derived rows, and temporal knowledge-graph facts, but dsh had no narrow inspection surface for that state. A browser-only mock would make the Web UI look integrated while leaving no trustworthy data API, and a write-capable maintenance surface would expand the security boundary before the read model is reviewed.

Retrieval transparency has a separate gap: MemPalace search can return candidates and scores, but the persisted files do not identify which memories or KG facts influenced one dsh answer or what context text entered that model request.

## Decision

`@deepseek-ai/dsh-api-mempalace-dashboard` is the Host owner of the read-only projection. It resolves MemPalace's local config and environment path conventions, opens the local `chroma` or `sqlite_exact` drawer database read-only, projects wing, room, drawer, passive-tunnel, explicit-tunnel, KG timeline, and count health views, and returns explicit unavailable states for unsupported backends, missing sidecars, missing KG files, unavailable maintenance scans, and absent retrieval traces.

`@deepseek-ai/dsh-client-ui-mempalace-dashboard` is the browser consumer. It registers one Settings section, calls the authenticated shared `/api` endpoint, and renders the Host snapshot without direct filesystem access. Both Web bundle rows are disabled by default; a deployment enables the Host row and browser row together when exposing local memory inspection is intended.

The projection reads files only. SQLite handles use `readOnly` and `PRAGMA query_only`; the adapter never shells out to the MemPalace CLI, never imports the read-only upstream clone, and does not edit MemPalace config or data. The endpoint remains behind the existing Connection Host/Origin checks and browser authentication.

## Alternatives considered

**Build only a browser mock.** That would satisfy layout work but hide whether MemPalace data can be normalized safely, and it would invite fabricated health and retrieval fields.

**Shell out to MemPalace MCP or CLI tools.** That would reuse upstream behavior but would execute another application from a Web API request and could trigger live backend loads, Hub forwarding, or write-path side effects outside dsh's lifecycle.

**Enable by default in the Web profile.** Local memory contents are sensitive, and some MemPalace configs point outside the Harness home. An opt-in row keeps the default Web surface unchanged until a user or deployment accepts that exposure.

**Represent missing traces as empty results.** Empty would mean a trace source was consulted and found no records. The correct state is unavailable because the inspected MemPalace files do not persist per-answer trace records.

## Verification

`packages/api/mempalace-dashboard/tests/projection.host.spec.ts` builds real SQLite fixtures for the `sqlite_exact` layout, KG rows, and `tunnels.json`, then covers filter normalization, limit clamping, structure/KG projection, passive and explicit tunnels, health unavailable signals, retrieval-trace unavailable states, missing palace, and unsupported backend responses.

`packages/client/ui-mempalace-dashboard/tests/apply.client.spec.tsx` covers client service declarations, lazy endpoint invocation, localized Settings section registration, late slot declaration, and teardown.

## Consequences

The first slice is small but functional: reviewers can inspect a typed Host projection, an authenticated API, and an opt-in Settings panel without accepting write operations or generated memory claims. The same response can later feed a graph canvas, timeline visualization, or drawer drilldown.

The limitation is explicit in the API. Retrieval traceability and deeper health analysis require upstream MemPalace to persist per-answer traces or maintenance scan results, or dsh to log a new model-visible retrieval event. Until that durable source exists, consumers render unavailable states instead of inferring trust data from current drawer contents.
