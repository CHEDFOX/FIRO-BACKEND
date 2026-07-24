# Delivery Roadmap (Phased)

The brief mandates phased delivery, and each phase is approved before the next.

> **Build order decision (owner):** build **all backend logic first**, then do
> the **visual frontend design last**. The Flutter renderer is still built in the
> middle as a **bare-bones, unstyled test harness** so we can prove the backend's
> screens work; the *premium visual design* is applied at the very end. This
> reorders the phases below toward backend-first.

**Status: Phase 2 (foundation) — in progress.** The backend now has a running,
tested NestJS foundation (see [firo-backend README](../README.md)).

## Phase 1 — Architecture ✅ (done)
Decisions, trade-offs, risks, ADRs, module map, data model, BDUI contract, API +
design-system conventions. See [architecture/](architecture/README.md).

## Phase 2 — Repository & foundation scaffolding 🚧 (in progress)
- [x] NestJS/TypeScript app skeleton (`api` + `worker` entrypoints), strict TS.
- [x] Shared kernel: response envelope, canonical error model + `AppError`,
      cursor pagination, UUIDv7 ids, `Result` type.
- [x] Global response-envelope interceptor + all-exceptions filter.
- [x] Validated config (zod) + health/meta endpoints.
- [x] CI (format check · lint · build · test) + unit + e2e tests (28 passing).
- [ ] OpenAPI 3.1 source of truth + TS/Dart codegen pipeline.
- [ ] Postgres wiring (PgBouncer + read replica), migration tooling, per-schema
      roles + boundary lint.
- [ ] Terraform skeleton, observability wiring.
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

## Module build progress
- **Identity** 🚧 — email/password auth, JWT access tokens, rotating refresh
  tokens with reuse detection, RBAC guards, `/v1/auth/{register,login,refresh,
  logout,me}`. Persistence is in-memory behind the repository ports; **Postgres
  adapters and OAuth (Apple/Google) are the remaining pieces.**
- Next: Catalog/Content (+ CMS + Media) → Personalization (DNA + Reco funnel) →
  Discovery (Search + Feed + Collections) → AI Gateway → Planning → Social →
  Commerce → Admin/Analytics.

## The first shippable slice (recommended target for Phases 4–7)
A real user journey over a **real curated catalog**:
**onboarding → personalized BDUI feed → experience detail → save to a collection.**
This exercises every seam (auth, BDUI, reco heuristic, CMS content, design tokens,
offline) without building any of the heavy machinery. Content bootstrapping (CMS
authoring + an initial curated set of destinations) is a first-class Phase-4 task —
a discovery product with an empty catalog demos nothing.
