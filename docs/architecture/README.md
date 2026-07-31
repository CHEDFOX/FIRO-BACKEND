# Firo Architecture (Phase 1)

This is the **Phase 1 deliverable: architecture only — no application code yet.**
It records decisions, trade-offs, risks, and the challenges we raise against the
product brief, for review and approval before any implementation begins.

## Read in order

1. [00 — Overview](00-overview.md) — the whole system on one page
2. [01 — Principles & Clean Architecture](01-principles.md)
3. [02 — System Topology](02-topology.md) — modular monolith, 8 contexts, folders
4. [03 — BDUI Engine](03-bdui-engine.md) — the crown jewel
5. [04 — Data Architecture](04-data-architecture.md)
6. [05 — Recommendation & Explorer DNA](05-recommendation-and-explorer-dna.md)
7. [06 — AI Layer](06-ai-layer.md)
8. [07 — Platform, Security & Observability](07-platform-security-observability.md)
9. [08 — API & Design System](08-api-and-design-system.md)
10. [09 — Challenges to the Brief](09-challenges-to-the-brief.md)
11. [10 — The Personal World Map (3D)](10-world-map.md)
12. [11 — Explorer DNA & the Personalised Feed](11-explorer-dna.md)

## Also

- [Architecture Decision Records](../adr/) — the 9 load-bearing decisions
- [Risks & Adversarial Review](../RISKS.md)
- [Delivery Roadmap](../ROADMAP.md)

## The TL;DR

- **Modular monolith** (NestJS/TypeScript), 8 bounded contexts, one Postgres
  cluster — designed to split into services at scale, deployed as one now.
- **Backend-Driven UI** drawn at the **semantics vs presentation** line: backend
  decides *what*, the Flutter client decides *how it looks and moves*.
- **REST + BDUI, no GraphQL.** OpenAPI 3.1 → generated TS + Dart.
- **PostgreSQL as the source of truth**; OpenSearch, Redis, S3/CloudFront around
  it; pgvector for AI. No day-one microservices, sharding, Kafka, or vector DB.
- **AI behind one Gateway.** Explorer DNA evolves asynchronously.
- **Design the seams for 100M; build for 100K.**
