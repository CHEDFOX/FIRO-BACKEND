# ADR-0009: OpenAPI 3.1 is the single contract source of truth

- **Status:** Accepted (Phase 1)

## Context
Backend and client must share typed contracts without drift. An early draft
proposed five parallel codegen systems (OpenAPI→TS+Dart, plus Zod, plus
JSON-Schema, plus Swift/Kotlin quicktype) — a maintenance and drift hazard flagged
by the red-team.

## Decision
**OpenAPI 3.1 (JSON-Schema 2020-12 dialect)** is the single source of truth for
the entire API. It generates **exactly two outputs**: backend **TypeScript** types
+ validators, and the **Flutter/Dart** client (freezed models). The **BDUI
Screen/Component/Action and design-token JSON Schemas fold into this same
pipeline.** Shared types are always a generated *output*, never hand-authored per
platform.

## Rationale
- One spec round-trips cleanly to both TS and Dart (unlike protobuf, which is
  awkward for REST/CDN/BDUI JSON).
- Contracts cannot drift when both sides regenerate from one file in CI.
- Folding BDUI + token schemas in gives one vocabulary across backend composer and
  client renderer.

## Consequences
- (+) No drift; one place to review contract changes; CDN-friendly REST.
- (−) Some teams find OpenAPI authoring verbose; mitigated by generating the spec
  from typed route definitions where practical.

## Alternatives rejected
- **Protobuf/gRPC as the source:** awkward for REST/CDN/BDUI JSON payloads.
- **Hand-shared TS types package:** can't serve a Dart client; drifts.
- **Multiple parallel codegens (the original draft):** drift + maintenance drag.
