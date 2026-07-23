# API Contracts, Shared Types & Design System

## API conventions

- **REST-first**, resource-oriented, **URL-versioned** (`/v1/...`). URL
  versioning is chosen over header versioning for cache/CDN friendliness and
  obviousness.
- **No GraphQL.** With BDUI the server already decides the exact shape of every
  screen; a client-driven query language is redundant and fights the
  architecture. BDUI *is* the aggregation layer. See
  [ADR-0005](../adr/0005-reject-graphql.md).
- A **thin BFF is deferred, not built** — revisit only when a genuinely different
  surface (web/partner) needs it.

### Response envelope

Every JSON resource endpoint returns one envelope:

```jsonc
{ "data": { /* resource or list */ },
  "meta": { "cursor": { "next": "eyJ...", "hasMore": true }, "requestId": "req_..." },
  "error": null }
```

On error, `data` is null and `error` is a canonical, machine-readable object:

```jsonc
{ "data": null, "meta": { "requestId": "req_..." },
  "error": { "code": "experience.not_found", "message": "…",
             "retryable": false, "details": {} } }
```

- **Cursor pagination** everywhere (opaque cursors; no offset/limit at scale).
- **Idempotency**: all mutations accept an `Idempotency-Key` header.
- **Carve-outs from the envelope** (explicit): **media** uses direct signed-URL
  upload/download; **streaming/AI** uses SSE/chunked. The uniform envelope applies
  to resource endpoints, not to bytes or streams.

## Shared contracts — one source of truth

**OpenAPI 3.1 (JSON-Schema 2020-12 dialect)** is the single source of truth for
the whole platform. Both sides are **generated**, never hand-authored:

```mermaid
flowchart LR
  Spec[[OpenAPI 3.1\n+ BDUI/token JSON Schemas]] --> TS[backend TS types + validators]
  Spec --> Dart[Flutter/Dart client\n(freezed models)]
```

- Backend: `openapi-typescript` types; DTO validation from the same spec.
- Client: Dart models generated from the same spec (`openapi-generator`, freezed).
- **The BDUI Screen/Component/Action/Token schemas fold into this one pipeline** —
  we do **not** run parallel Zod + JSON-Schema + quicktype codegens (that was an
  over-engineered draft; see [RISKS](../RISKS.md)). One source → exactly two
  outputs: TS + Dart.

## Design system as data

The design system ships as a **versioned, themeable token document**, not as
hardcoded client constants. Tokens are authored in **Style Dictionary** and
delivered via `GET /v1/theme/{themeId}` (long-TTL, ETag, CDN-cached).

```jsonc
// theme.json (abridged)
{ "themeId": "firo.default", "version": "2026.07.1",
  "color":  { "surface": { "base": "#0B0B0F", "raised": "#141419" },
              "text": { "primary": "#F5F5F7", "muted": "#9A9AA5" },
              "accent": { "aurora": "#7FD8C4" } },
  "radius": { "card": 20, "hero": 28 },
  "space":  { "section": { "compact": 12, "comfortable": 20, "spacious": 32 } },
  "type":   { "display": { "family": "…", "weight": 600 } },
  "elevation": { "card": "shadow.soft" } }
```

- Components reference **semantic token names** (`color.surface.raised`,
  `space.section`, `radius.card`) — never raw values. Dark mode and future themes
  are pure client-side token swaps.
- The **component catalog contract** — the canonical list of renderable component
  types and their prop schemas — is the shared vocabulary between the backend
  BDUI composer and the client renderer. It lives in the contract repo alongside
  the token schema.

## The component prop schema (shared vocabulary)

```jsonc
// registry/card.v1.schema.json (abridged)
{ "type": "card.v1",
  "props": { "emphasis": { "enum": ["hero","standard","muted"] },
             "aspect":   { "enum": ["16:9","4:5","1:1","3:4","auto"] } },
  "content": { "title": "string", "media": "MediaRef", "entity": "EntityRef" },
  "actions": "Action[]" }
```

Configure **data and composition** (which components, in what order, with what
props/tokens); keep the **set of component types and their prop schemas** as a
versioned, code-reviewed contract. Adding a component type is a contract change +
a client release — deliberately, so the client can always render what the server
sends.

## Phase 1 scope

Freeze the response envelope + error model + pagination + idempotency
conventions; stand up the OpenAPI 3.1 source of truth with TS + Dart codegen;
fold in the BDUI + token + component schemas; ship the `firo.default` +
`firo.dark` themes via the theme endpoint.
