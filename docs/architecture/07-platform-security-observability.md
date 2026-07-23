# Platform, DevOps, Security & Observability

## Infrastructure

| Concern | Phase 1 | Scale path |
|---|---|---|
| Cloud | **AWS** | deepest managed catalog; matches team size and the 100M ceiling |
| IaC | **Terraform + Terragrunt** | DRY multi-env, remote state, per-env isolation |
| Compute | **ECS Fargate** behind an ALB | no cluster ops; **EKS only** when scheduling/multi-region/spot demands it |
| Edge | **CloudFront + AWS WAF + Shield** | imgproxy on Fargate for on-the-fly image transforms |
| Data | **RDS Postgres (+ read replica), ElastiCache Redis, OpenSearch, S3** | managed; single-region multi-AZ now |

**A small team should not operate an EKS control plane to run a modular
monolith.** ECS Fargate scales to millions of users fine; we design the
containers to be portable so the EKS move is mechanical if a trip-wire fires.

## CI/CD

- **GitHub Actions**, **trunk-based development** with short-lived branches.
- Backend pipeline: install → typecheck → lint → test → build → **expand/contract
  migrations** → **blue/green ECS deploy**. Security scan (SAST + dependency
  audit + secret scan) gates merge.
- Mobile pipeline: **Fastlane release trains** + EAS/Firebase distribution;
  **phased store rollouts**.
- **"OTA" = the BDUI config plane + feature flags**, not JS code-push. Behavior
  and UI change server-side; binary releases are reserved for the renderer engine
  and native capabilities. This is the core payoff of BDUI.

## Authentication & session

First-party auth service issuing **short-lived asymmetric JWT access tokens
(EdDSA, JWKS-published)** + **rotating, device-bound, hashed refresh tokens**.
OAuth with **Apple and Google**. We **own the identity graph** (right call for
cost/lock-in) but build exclusively on **vetted libraries** (jose/paseto-grade
JWT, argon2id) — never roll our own crypto.

```jsonc
// access token claims (abridged)
{ "sub": "usr_01J...", "sid": "sess_01J...", "roles": ["user"],
  "scope": ["read","write"], "iat": ..., "exp": "+15m", "iss": "firo.auth", "aud": "firo.api" }
```

Device/session management: refresh tokens are per-device, revocable, and rotate
on use (reuse detection → revoke session family).

## Authorization (RBAC)

One RBAC model across users, creators, and admin. Roles → permissions checked in
the application layer (a typed, tested invariant — never configured away). Admin
is a distinct role set with fine-grained, audited permissions; creator is a
scoped elevation over `user`.

## Security controls

- **Rate limiting** (Redis token-bucket) + WAF at the edge.
- **Encryption** in transit (TLS) and at rest (RDS/S3/KMS).
- **Secure media**: direct-to-S3 uploads via **signed URLs**; server issues the
  grant, never proxies the bytes; derivatives generated async.
- **Audit logging** for Tier-A mutations and all admin actions.
- **Secrets** in AWS Secrets Manager / SSM; never in env files or the repo.
- **Input validation** at the edge of every module (DTO schemas derived from the
  OpenAPI contract).

## Privacy & data governance

Explorer DNA is deep behavioral PII. Treat it as first-class regulated data:
- PII and DNA live in dedicated schemas with dedicated DB roles.
- **GDPR/CCPA data-subject flows** (export, delete) designed in from Phase 1 as
  first-class jobs — soft-delete + a scheduled hard-erase path.
- **PII redaction before any model call** (see [06-ai-layer](06-ai-layer.md)).
- Minors, precise-location, and messaging get extra scrutiny in the threat model.
  *(Full trust-&-safety / moderation policy is expanded in [RISKS](../RISKS.md)
  pending the security red-team lens.)*

## Observability

- **Structured JSON logs** with correlation/trace ids.
- **Metrics**: RED (rate/errors/duration) per endpoint, USE for resources.
- **Distributed tracing** via **OpenTelemetry**.
- **Error/crash reporting** via **Sentry** (backend + mobile).
- **Health checks** + **SLOs** with alerting; dashboards for the golden signals,
  AI spend, and feed latency.

## The config plane (unifying flags, experiments, CMS, BDUI)

Feature Flags, Experiments, CMS content, and BDUI are **one config-resolution
plane** with a defined precedence: CMS content + resolved flags + experiment
assignments feed a single **BDUI response assembler**, writing one audit trail.
This avoids four overlapping "who decided this pixel" systems.
