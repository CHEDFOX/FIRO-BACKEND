# Challenges to the Brief

The brief explicitly asks us to *challenge weak architectural decisions and
propose better alternatives.* Here is every pushback, consolidated. Each is
backed by an ADR or a pillar doc. **None of these reject the brief's vision** —
they protect it from implementations that would undermine "premium, emotional,
intelligent" or the timeline.

| # | Brief instruction | Our position | Better alternative | Backed by |
|---|---|---|---|---|
| 1 | "Backend decides everything, incl. animations and spacing." | **Reject (partial).** | Draw the line at **semantics vs presentation**. Backend controls what/which/order/visibility/copy/actions/theme-tokens and emphasis *intent*; the client owns animation, gestures, spacing scale, transitions. Server-driven pixels produce a laggy, generic UI. | [ADR-0003](../adr/0003-bdui-semantics-vs-presentation-boundary.md), [03](03-bdui-engine.md) |
| 2 | "~25 independent modules." | **Reject.** | **8 bounded contexts.** 25 nano-services is a staffing model we don't have; the contexts still give clean seams. | [ADR-0001](../adr/0001-modular-monolith-over-microservices.md), [02](02-topology.md) |
| 3 | "Each module independent" ⇒ microservices/DB-per-service. | **Reject for Phase 1.** | **Modular monolith on one Postgres cluster**, schema-per-module, boundaries by lint + roles. Same extraction seam, none of the distributed-systems tax. | [ADR-0001](../adr/0001-modular-monolith-over-microservices.md) |
| 4 | "AI layer as separate services (plural)." | **Reject (operationally).** | **One AI Gateway + worker pool** behind a narrow `AiPort`. Decouple logically, not into microservices. | [ADR-0006](../adr/0006-single-ai-gateway.md), [06](06-ai-layer.md) |
| 5 | "Every interaction updates Explorer DNA." | **Refine.** | Keep the guarantee, drop the synchronous write: emit a typed event, **fold into DNA asynchronously** with decay + confidence. Synchronous DNA writes are a scaling bottleneck. | [ADR-0007](../adr/0007-async-explorer-dna.md), [05](05-recommendation-and-explorer-dna.md) |
| 6 | "Never hardcode application logic; everything configurable." | **Refine.** | Configure **presentation and policy** (layout, flags, weights, copy); keep **invariants** (auth, pricing, safety, integrity) as typed, tested code. Configuring safety logic is how you ship incidents. | [01 §2](01-principles.md) |
| 7 | "REST-first, GraphQL only if justified." | **Decide: reject GraphQL.** | REST + BDUI. BDUI *is* the aggregation layer, so a client query language is redundant and fights the architecture. | [ADR-0005](../adr/0005-reject-graphql.md), [08](08-api-and-design-system.md) |
| 8 | "Vector (future)" + broad polyglot store list. | **Refine.** | **pgvector inside Postgres now**; a dedicated vector DB and graph DB deferred behind numeric trip-wires. No day-one Kafka/warehouse. | [ADR-0004](../adr/0004-postgres-single-source-of-truth.md), [04](04-data-architecture.md) |
| 9 | "Audit tables, soft deletes, history" applied uniformly. | **Refine.** | **Tier the durability policy**: core aggregates get audit+history+soft-delete; high-volume event data is append-only/partitioned; derived data is rebuildable. | [04](04-data-architecture.md) |
| 10 | "Design for 100M+ users" ⇒ build for 100M now. | **Refine.** | **Design the seams for 100M, build for 100K.** UUIDv7 keys, stateless services, cursor pagination now; sharding/CDC/multi-region behind trip-wires. | [01 §5](01-principles.md) |
| 11 | "Reco emits components / is one all-knowing engine." | **Refine.** | Reco emits **semantic ranked entity refs + intent**; a thin BDUI contributor maps them to components. One reusable funnel, many surfaces. | [05](05-recommendation-and-explorer-dna.md) |
| 12 | "Multiple mobile clients" ⇒ several native codebases. | **Refine.** | **One Flutter codebase** → iOS + Android + future web. BDUI already externalizes product logic, so a web renderer is additive. | [ADR-0008](../adr/0008-flutter-client.md) |
| 13 | Trip assistant "agentic." | **Refine.** | **Bounded tool-use**: deterministic skeleton + LLM slot-filling, hard ceilings, allow-listed validated tools. Feels intelligent, stays safe/cheap. | [06](06-ai-layer.md) |

## Two challenges we raise against *ourselves* (from the red-team)

Even after the above, the adversarial review caught two places where **our own
Phase-1 design over-engineered**:

- We initially smuggled distributed-systems machinery (no cross-module FKs, a
  transactional outbox, a Debezium→Kafka→warehouse CDC pipeline) into the "simple"
  monolith. **Corrected:** keep real FKs in the one cluster, defer the outbox to
  the 2–3 genuinely async flows, defer CDC/warehouse entirely to Phase 2.
- We initially specced five parallel contract/codegen systems. **Corrected:** one
  OpenAPI 3.1 source → exactly TS + Dart.

Full detail in [RISKS.md](../RISKS.md).
