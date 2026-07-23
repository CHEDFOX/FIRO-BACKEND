# ADR-0008: Flutter for the client renderer

- **Status:** Accepted (Phase 1) — *confirm before Phase 5*

## Context
The brief wants a premium, animation-rich, image/video-heavy discovery app on
"multiple mobile clients" plus a future web platform, where the client is a thin
BDUI rendering engine. The framework choice affects hiring and is worth explicit
sign-off.

## Decision
**Flutter** (Dart 3, Impeller renderer) for the mobile client, targeting iOS +
Android from one codebase, with a path to web.

## Rationale
- A single render pipeline we fully control is ideal for a **JSON-driven widget
  tree** — exactly what a BDUI renderer is.
- Best-in-class animation and image/video performance for a premium, media-heavy
  feel; no JS-bridge tax.
- One codebase → iOS/Android/(web), satisfying "multiple clients" without
  multiple native codebases.
- The usual counter-argument ("share TypeScript with the backend") is weak here:
  contracts are **generated** for both TS and Dart from one OpenAPI source
  (ADR-0009), so there is no hand-shared type advantage to React Native.

## Consequences
- (+) Deterministic control of the rendered tree; premium motion; multi-platform.
- (−) Dart is a separate language/hiring pool from the backend. Accepted, and
  mitigated by generated contracts.
- (−) Some native platform integrations need platform channels. Accepted.

## Alternatives considered
- **React Native / Expo:** shares TS and is easier to hire for, but the JS bridge
  and less deterministic control over an animated JSON-driven tree make it a
  weaker fit for the BDUI renderer. Viable fallback if Dart hiring is a blocker.
- **Kotlin Multiplatform:** strong native feel but less mature single-codebase
  UI story for this use case.

> **Action:** confirm Flutter vs React Native with product/eng leadership before
> Phase 5 begins.
