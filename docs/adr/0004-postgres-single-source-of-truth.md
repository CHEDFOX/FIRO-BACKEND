# ADR-0004: PostgreSQL as the single source of truth

- **Status:** Accepted (Phase 1)

## Context
The brief implies a broad polyglot persistence layer and a "future" vector store.
Standing up many stores early multiplies operational surface and dual-write bugs.

## Decision
**PostgreSQL 16** is the system of record for everything transactional, using
**PostGIS** (geo), **pgvector** (embeddings), and **JSONB** (CMS/BDUI payloads),
with **schema-per-module** isolation on **one cluster**. Exactly four purpose-
built stores sit around it: **OpenSearch** (search), **Redis** (cache/
queues/feeds), **S3+CloudFront** (media), and — **Phase 2** — a columnar
warehouse for analytics/ML.

We **reject** for Phase 1: a dedicated vector DB, a graph DB, and a document DB.
Each is deferred behind a numeric **trip-wire** (see
[../architecture/04-data-architecture](../architecture/04-data-architecture.md)).

### Phase-1 nuance on foreign keys
Cross-*module* FKs are forbidden long-term (they'd block extraction). But in
Phase 1, where the whole system is one cluster, we **keep real FKs** and enforce
module boundaries via lint + per-schema roles, adding soft-references only where a
split is actually planned — rather than paying distributed-systems costs before we
have a distributed system.

## Consequences
- (+) One backup/restore/CDC story; transactional integrity; vectors written
  in-transaction with their entity (no dual-write).
- (+) Carries us past 10M users vertically + read replicas.
- (−) A single cluster is a scaling ceiling; mitigated by PgBouncer + read
  replica now and the shard/extraction seam (UUIDv7 keys) for later.

## Alternatives rejected
- **DB-per-microservice from day one:** premature; see ADR-0001.
- **Dedicated vector DB now:** unnecessary dual-write until the vector trip-wire.
- **Mongo/Dynamo for flexibility:** JSONB gives document flexibility with one
  source of truth.
