# ADR-0005: REST + BDUI, reject GraphQL

- **Status:** Accepted (Phase 1)

## Context
The brief leaves GraphQL open ("GraphQL only if justified"). GraphQL's value is
letting clients shape their own queries to avoid over/under-fetching.

## Decision
Commit to **REST-first + BDUI**. Do **not** build GraphQL.

## Rationale
With Backend-Driven UI, the **server already decides the exact shape of every
screen** and returns a composed tree. A client-driven query language is redundant
and actively fights the architecture — the client is *not supposed* to shape the
payload; that's the whole point of BDUI. GraphQL would also add a second contract
system alongside OpenAPI, a caching headache, and N+1 resolver risk.

## Consequences
- (+) One contract system (OpenAPI 3.1), CDN-cacheable screen endpoints, simpler
  ops and security surface.
- (−) A future non-BDUI surface (public partner API, web dashboard) might want
  flexible querying. Accepted: revisit with a scoped BFF or GraphQL gateway *only*
  when such a surface has a proven need. It would sit beside, not replace, BDUI.

## Alternatives rejected
- **GraphQL as the primary API:** contradicts BDUI; redundant aggregation layer.
- **GraphQL for internal service-to-service:** we're a monolith; in-process port
  calls are simpler.
