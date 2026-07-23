# Risks & Adversarial Review

This architecture was put through an adversarial red-team. Findings below are
**incorporated** into the pillar docs; this page is the consolidated risk
register.

> **Review coverage note:** two lenses completed fully — **Scale & Cost at 100M**
> and **Delivery Risk / Over-engineering (YAGNI)**. Two further lenses
> (**Product/UX** and **Security/Privacy deep-dive**) did not return in this run;
> their concerns are partially covered by the design pillars
> ([07-platform-security-observability](architecture/07-platform-security-observability.md)
> for security, [03-bdui-engine](architecture/03-bdui-engine.md) for UX). A
> re-run of those two lenses is recommended before Phase 2 sign-off.

## P0 — must fix before/within Phase 1

| Risk | Impact | Correction (applied) |
|---|---|---|
| **Behavioral firehose in OLTP** | Every tap/scroll written as append-only rows into the same cluster holding transactional data + vector indexes = trillions of rows fighting the core DB at scale | Emit signals to a **durable log** (Kinesis/PubSub); keep only the **derived `dna_profile` snapshot** + a small recent-signal window in Postgres. [04](architecture/04-data-architecture.md), [05](architecture/05-recommendation-and-explorer-dna.md) |
| **Self-inflicted distributed-systems complexity** | No cross-module FKs + transactional outbox + Debezium→Kafka→warehouse CDC "skeleton" in a single-cluster monolith = all the pain of distribution, none of the benefit | **Keep real FKs** in the one cluster; enforce boundaries by lint + schema roles. **Defer the outbox** to the 2–3 genuinely async flows. **Defer CDC/warehouse entirely to Phase 2** (log events to Postgres/S3 for now). [02](architecture/02-topology.md) |
| **Per-user BDUI caching** | Caching rendered screens per user id gives ~0% hit rate and melts Redis | **Segment-cacheable shell + per-user hole-punching**: cache by DNA *segment* bucket (hundreds), not per-user context hash. [03](architecture/03-bdui-engine.md) |
| **Five parallel contract/codegen systems** | OpenAPI→TS+Dart *plus* Zod *plus* JSON-Schema *plus* Swift/Kotlin quicktype = drift and maintenance drag | **One source (OpenAPI 3.1) → exactly TS + Dart.** Fold BDUI/token schemas in; delete the rest. [08](architecture/08-api-and-design-system.md) |

## P1 — address early

| Risk | Impact | Correction |
|---|---|---|
| **No PgBouncer / read replica in Phase 1** | Connection exhaustion; read load on the primary | Add **transaction pooling + one read replica from day one** (cheap, mechanical). [04](architecture/04-data-architecture.md) |
| **Media has no cost controls** | Uncapped storage/upload/transcode spend | Make media a **first-class cost domain**: per-user quotas/rate-limits, derivative- and transcode-on-demand, tiered storage, a defined video ladder budget. [07](architecture/07-platform-security-observability.md) |
| **Phase-1 BDUI scoped to _every_ screen** | Building the whole app as BDUI (auth, onboarding, settings, nav graph) before shipping anything | Narrow Phase-1 BDUI to **dynamic-value screens** (feed, discovery, collection, content-detail, onboarding). Keep auth, settings, and the nav shell native. [03](architecture/03-bdui-engine.md) |
| **Reco funnel over-built for Phase 1** | Five-stage funnel + session-pinned snapshots before there's data to rank | **Single ranked query behind the `Scorer` interface** with keyset cursors; keep only the interface seams. [05](architecture/05-recommendation-and-explorer-dna.md) |
| **pgvector co-located with OLTP** | ANN index CPU competes with transactional load once catalog embeddings are large | Acceptable at launch; **trip-wire** to a separate pgvector instance / Qdrant at ~30–50M vectors or >20% OLTP CPU. [04](architecture/04-data-architecture.md) |

## P1 — capacity model owed

Before Phase 2 build sign-off, produce an **actual capacity + cost model**:
events/sec, write TPS, storage growth, Redis working-set GB, CDN egress $/mo, and
AI enrichment/embedding spend. The architecture is sound directionally, but no
numbers have been committed yet.

## Open items (pending the un-run lenses)

- **Trust & safety / moderation policy** for UGC, community, messaging, creators —
  needs a dedicated pass (minors, precise location, DM safety).
- **Product/UX validation** that BDUI composition delivers the "premium,
  emotional" feel on the target screens — recommend a design-partner prototype of
  the feed + content-detail before committing the component registry.
