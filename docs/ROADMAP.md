# Delivery Roadmap (Phased)

The brief mandates phased delivery, and each phase is approved before the next.
**We are here: Phase 1 (Architecture) — this document set.** Nothing below Phase 1
is built until approved.

## Phase 1 — Architecture ✅ (this deliverable)
Decisions, trade-offs, risks, ADRs, module map, data model, BDUI contract, API +
design-system conventions. Reviewable. **No application code.**

## Phase 2 — Repository & foundation scaffolding
- Monorepo layout (Nx) for `firo-backend`; app + worker skeletons.
- Shared libs: response envelope, error model, pagination, UUIDv7 ids, result types.
- OpenAPI 3.1 source of truth + TS/Dart codegen pipeline.
- Postgres cluster config (PgBouncer + read replica), migration tooling, per-schema roles + boundary lint.
- CI/CD (typecheck, lint, test, migrate, deploy), Terraform skeleton, observability wiring.
- **Gate:** capacity/cost model produced; the two un-run red-team lenses re-run.

## Phase 3 — Infrastructure
Terraform for AWS (ECS Fargate, RDS, ElastiCache, OpenSearch, S3/CloudFront, WAF),
environments (dev/staging/prod), secrets, dashboards/alerts.

## Phase 4 — Backend foundation
Identity context (auth, JWT, Apple/Google, RBAC), the shared kernel, health/obs,
the config plane skeleton (flags/experiments/CMS/BDUI assembler).

## Phase 5 — Frontend renderer
Flutter BDUI rendering engine: component registry, unknown-component fallback,
theme/token resolver, declarative navigation, offline cache, auth/session. (See
`firo-frontend/docs/`.)

## Phase 6 — Backend-Driven UI engine
The BDUI module: frozen schema, composition pipeline, `SectionContributor`
interface, Redis SWR caching, golden payloads + contract tests, the curated
component registry.

## Phase 7 — Authentication (end-to-end)
Wire client auth to the Identity context; onboarding flow (BDUI) seeding Explorer DNA.

## Then, module by module
Catalog/Content (+ CMS + Media) → Personalization (DNA + Reco funnel) → Discovery
(Search + Feed + Collections) → AI Gateway capabilities → Planning → Social →
Commerce → Admin/Analytics.

## The first shippable slice (recommended target for Phases 4–7)
A real user journey over a **real curated catalog**:
**onboarding → personalized BDUI feed → experience detail → save to a collection.**
This exercises every seam (auth, BDUI, reco heuristic, CMS content, design tokens,
offline) without building any of the heavy machinery. Content bootstrapping (CMS
authoring + an initial curated set of destinations) is a first-class Phase-4 task —
a discovery product with an empty catalog demos nothing.
