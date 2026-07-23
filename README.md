# Firo — Backend

> **AI-powered travel _discovery_ platform.** Inspire first. Plan second. Book last.

This repository will hold the Firo backend: a **modular monolith** (NestJS /
TypeScript) that owns the entire application state and drives the mobile client
through a **Backend-Driven UI (BDUI)** protocol.

## Status: Phase 2 — Foundation (in progress)

Phase 1 (architecture) is complete and the **backend foundation now runs**: a
NestJS/TypeScript app with the shared kernel (response envelope, error model,
cursor pagination, UUIDv7 ids), a validated config, health/meta endpoints, CI,
and a passing unit + e2e test suite. Business modules are added next, backend
logic first.

- Start here → [Architecture Overview](docs/architecture/00-overview.md)
- The key decision → [BDUI semantics/presentation boundary](docs/adr/0003-bdui-semantics-vs-presentation-boundary.md)
- What we changed about the brief → [Challenges to the Brief](docs/architecture/09-challenges-to-the-brief.md)
- Risks → [RISKS.md](docs/RISKS.md) · Plan → [ROADMAP.md](docs/ROADMAP.md)

## Running the backend

Requires Node ≥ 22 and pnpm.

```bash
pnpm install            # install dependencies
pnpm build              # type-check + compile (tsc)
pnpm test               # unit + e2e tests
pnpm lint               # eslint
pnpm format             # prettier --write

pnpm start:dev          # run the API in dev (ts-node)
pnpm start              # run the compiled API (node dist/main.js)
pnpm start:worker       # run the background worker
```

Quick check once running (default port 3000):

```bash
curl localhost:3000/health      # raw liveness report
curl localhost:3000/v1/meta     # enveloped API info
```

Project layout:

```
src/
  main.ts · worker.ts        # api + worker entrypoints (one modular monolith)
  app.module.ts              # composition root (bounded contexts mount here)
  bootstrap/                 # app factory, validated config
  shared/                    # response envelope, errors, pagination, ids, Result
  platform/                  # cross-cutting: health, meta (later: BDUI, AI gateway, flags)
test/                        # e2e specs
```

## Architecture at a glance

| | |
|---|---|
| Style | Modular monolith, 8 bounded contexts, Clean Architecture per module |
| Backend | TypeScript · Node 22 · NestJS (Fastify) |
| Data | PostgreSQL 16 (PostGIS · pgvector · JSONB) · OpenSearch · Redis · S3/CloudFront |
| AI | Anthropic Claude (Haiku/Sonnet/Opus) behind one AI Gateway · Voyage embeddings |
| Client | Flutter — a thin BDUI rendering engine (see `firo-frontend`) |
| API | REST + BDUI · OpenAPI 3.1 → generated TS + Dart · no GraphQL |
| Infra | AWS · Terraform · ECS Fargate · GitHub Actions |

## Companion repo
[`firo-frontend`](../firo-frontend) — the Flutter rendering engine.

## Principle
The backend controls the **semantics** of the experience (what to show, in what
order, to whom, wired to which actions). The client controls the **presentation**
(how it looks and moves). See [ADR-0003](docs/adr/0003-bdui-semantics-vs-presentation-boundary.md).
