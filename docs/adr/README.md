# Architecture Decision Records

Load-bearing decisions for Firo. Each ADR states context, the decision,
consequences, and the alternatives rejected.

| ADR | Decision |
|---|---|
| [0001](0001-modular-monolith-over-microservices.md) | Modular monolith over microservices |
| [0002](0002-nestjs-typescript.md) | NestJS + TypeScript for the backend |
| [0003](0003-bdui-semantics-vs-presentation-boundary.md) | BDUI semantics/presentation boundary *(the key decision)* |
| [0004](0004-postgres-single-source-of-truth.md) | PostgreSQL as the single source of truth |
| [0005](0005-reject-graphql.md) | REST + BDUI, reject GraphQL |
| [0006](0006-single-ai-gateway.md) | One AI Gateway, not AI microservices |
| [0007](0007-async-explorer-dna.md) | Explorer DNA evolves asynchronously |
| [0008](0008-flutter-client.md) | Flutter for the client renderer *(confirm before Phase 5)* |
| [0009](0009-openapi-single-source-of-truth.md) | OpenAPI 3.1 as the single contract source |

## Status legend
- **Accepted (Phase 1)** — agreed as part of the Phase 1 architecture.
- Some ADRs carry a **confirm/revisit** note or a **trip-wire** for when to
  reconsider.
