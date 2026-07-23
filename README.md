# Firo — Backend

> **AI-powered travel _discovery_ platform.** Inspire first. Plan second. Book last.

This repository will hold the Firo backend: a **modular monolith** (NestJS /
TypeScript) that owns the entire application state and drives the mobile client
through a **Backend-Driven UI (BDUI)** protocol.

## Status: Phase 1 — Architecture

There is **no application code yet**. This repo currently contains the reviewed
Phase 1 architecture. See **[`docs/architecture/`](docs/architecture/README.md)**.

- Start here → [Architecture Overview](docs/architecture/00-overview.md)
- The key decision → [BDUI semantics/presentation boundary](docs/adr/0003-bdui-semantics-vs-presentation-boundary.md)
- What we changed about the brief → [Challenges to the Brief](docs/architecture/09-challenges-to-the-brief.md)
- Risks → [RISKS.md](docs/RISKS.md) · Plan → [ROADMAP.md](docs/ROADMAP.md)

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
