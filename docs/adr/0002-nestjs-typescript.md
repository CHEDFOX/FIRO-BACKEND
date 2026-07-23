# ADR-0002: NestJS + TypeScript for the backend

- **Status:** Accepted (Phase 1)

## Context
We need a backend framework for a domain-rich, BDUI-heavy, fast-iterating product
built by a small team, that also integrates tightly with an LLM provider.

## Decision
**TypeScript on Node 22 LTS**, framework **NestJS** (Fastify HTTP adapter).

## Rationale
- One type language across backend, the shared OpenAPI-generated contracts, and
  the (generated) client — reduces cognitive load and drift.
- NestJS modules + dependency injection map almost 1:1 onto bounded contexts and
  Clean-Architecture ports; batteries-included (guards, interceptors, pipes,
  OpenAPI) without a heavy JVM.
- First-class Anthropic TypeScript SDK.
- Fastify adapter for higher throughput/lower latency than Express.

## Consequences
- (+) Fast product iteration; easy hiring; shared contracts.
- (−) Node is single-threaded per process — CPU-heavy work (embeddings, image
  transforms) goes to the `worker` process or dedicated services, never the API
  hot path.

## Alternatives rejected
- **Kotlin/Spring or Java:** excellent at scale but heavier for a small team and
  breaks the one-language story.
- **Go:** great runtime, but less ergonomic for a rich domain + BDUI composition
  and no shared types with the client. Reconsider for a specific extracted
  hot-path service later.
