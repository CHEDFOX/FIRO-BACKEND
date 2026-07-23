# ADR-0003: BDUI is a semantic protocol — the semantics/presentation boundary

- **Status:** Accepted (Phase 1)
- **This is the single most important decision in the system.**

## Context
The brief says the backend should control screens, layout, sections, ordering,
spacing, animations, components, texts — "frontend becomes a rendering engine."
Taken literally ("backend controls spacing and animations"), this destroys the
premium, emotional feel and tanks performance: server round-trips can't drive
60/120fps motion, and pixel values on the wire produce a generic, laggy UI.

## Decision
Backend-Driven UI is a **server-composed semantic protocol, not a remote UI
framework.**

- **Backend owns SEMANTICS:** which screens exist; which sections, in what order,
  with what visibility; which *component type*; content/copy; *actions*;
  targeting/experiment/theme *selection*; emphasis/density **intent** (enums).
- **Client owns PRESENTATION:** the native widget per type; animation curves,
  springs, haptics; the spacing scale (from tokens); gesture/scroll physics;
  rendering performance; the native accessibility tree.

The wire contract contains **no geometry, no timing, no expressions, no scripts.**
`emphasis: "hero"` and `density: "comfortable"` are allowed; `marginTop: 14` and
`animationDurationMs: 320` do not exist in the schema.

## Consequences
- (+) Product/ops change layout, order, content, targeting, and copy server-side
  without an app release — the real payoff of BDUI.
- (+) The client stays fast and premium; motion is native.
- (+) The closed action vocabulary is also the security boundary — payloads can
  never execute code.
- (−) Adding a new *component type* or interaction still needs a client release.
  Accepted deliberately: the client must always be able to render what the server
  sends (unknown types hit a mandatory non-crashing fallback).

## Alternatives rejected
- **Full remote UI (server sends pixels/layout geometry/animation specs):**
  rejected — laggy, generic, unmaintainable, insecure.
- **Fully native screens (no BDUI):** rejected — every product change becomes an
  app release; loses the merchandising agility the product needs.
