# Agent Note: Shared API interceptor coexistence

Status: implemented

English | [中文](2026-09-03-shared-api-interceptor-coexistence.zh.md)

## Problem

The Host Connection stored only one `/api` interceptor. When the MemPalace Dashboard registered its endpoint before Typert Gateway, it displaced every generated Remote endpoint. The Web shell still rendered, but workspace selection, plugin inspection, and other unary APIs returned HTTP 404.

## Decision

Connection keeps a set of interceptor claims for the shared `/api` route. Dispatch evaluates every claim for the requested endpoint: no owner returns 404, exactly one owner receives the request, and multiple owners fail closed with HTTP 500. Each claim remains fiber-scoped and removes only itself on disposal.

The Web profile statically mounts the in-app browse picker and its Host backend. That interaction works from local and remote browsers, is independent of a Host display, and is exercised by the same Playwright composition shipped to users. Native and adaptive picker packages remain explicit alternatives.

## Alternatives considered

- Keep a single interceptor and fold Dashboard into Typert Gateway: rejected because Connection is the transport ownership boundary and independent feature endpoints must compose without modifying Gateway.
- Register Dashboard as a separate HTTP prefix: rejected because it would duplicate the shared `/api` trust, authentication, envelope, and client-caller contract.
- Keep the adaptive picker as the Web default: rejected for the browser product because its OS dialog depends on the Host display and cannot serve remote browsers; it remains available to explicit deployments.

## Consequences

- Dashboard, generated Remote services, and future disjoint unary owners can coexist on `/api`.
- Overlapping endpoint claims fail closed at dispatch instead of depending on registration order.
- The Web selector consistently uses the in-app browse interaction; an operator chooses native or adaptive behavior by composition.
- Playwright worlds inherit production picker wiring instead of patching in a parallel test-only pair.

## Verification

Host tests cover disjoint Dashboard and Typert-style owners, overlapping claims, authentication, disposal, and unclaimed endpoints. Playwright covers cold-start folder creation, existing-folder adoption, reload persistence, duplicate-name rejection, rename, grouped and flat views, registration deletion, startup auto-selection, blank-session folding, and preset selection. A built integrated server repeats the full workspace lifecycle with no `/api` failures or page errors.
