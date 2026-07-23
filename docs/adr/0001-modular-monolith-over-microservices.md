# ADR-0001: Modular monolith over microservices

- **Status:** Accepted (Phase 1)
- **Deciders:** Architecture

## Context
The brief lists ~25 "independent modules" and targets 100M users, which reads as
a mandate for microservices. We have a small team and zero users today.

## Decision
Build a **modular monolith**: one deployable `api` service + one `worker`
process, organized into **8 bounded contexts**, each owning one Postgres schema
and exposing a single `public-api` port. Boundaries are enforced by Nx
module-boundary lint, per-schema DB roles, and a migration lint that blocks
cross-*module* foreign keys.

## Consequences
- (+) No network hops, distributed transactions, or per-service ops overhead now.
- (+) The **extraction seam** exists: a hot module can later become its own
  service by swapping its in-process port adapter for an HTTP/gRPC client and
  moving its schema to its own DB — mechanically, without a rewrite.
- (−) Requires discipline to keep boundaries hard; mitigated by CI lint.
- (−) One deploy unit means a bad deploy affects everything; mitigated by
  blue/green deploys and strong test gates.

## Alternatives rejected
- **Microservices-first:** premature; buys independent scaling we don't need at
  the cost of complexity we can't afford.
- **Big-ball-of-mud monolith:** no seams; would require the rewrite we're avoiding.

## Trip-wire to revisit
Extract a module into its own service when its deploy coupling, write IOPS, or
blast radius exceeds the shared-cluster budget (see [../04-data-architecture](../architecture/04-data-architecture.md)).
