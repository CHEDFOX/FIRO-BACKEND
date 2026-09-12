# Deploying the Firo backend

The service is a single stateless container. It needs no database yet (see the
warning below), so deployment is genuinely simple today.

> **Status:** the Dockerfile is written and the production build is verified
> (`NODE_ENV=production node dist/main.js` serves correctly). The image itself
> has **not** been built or run, because the development sandbox has the Docker
> CLI but no Docker daemon. Run `docker build` once locally before trusting it
> in a pipeline.

## ⚠️ Read this before deploying

All data lives **in memory**. Every restart, redeploy, or crash wipes every
account, save and taste profile. That is fine for a demo or an internal preview;
it is not fine for real users. Wiring Postgres behind the existing repository
ports is the next step — the interfaces are already in place, so it is an
adapter swap, not a rewrite.

Also: run **exactly one instance** until Postgres exists. Two instances keep
separate memory, so a user would randomly appear logged out.

## Configuration

Everything is environment variables, validated with zod at startup — the process
exits immediately with a clear message if anything is missing or malformed.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | set to `production` |
| `PORT` | no | `3000` | most hosts inject this |
| `JWT_SECRET` | **yes in prod** | dev placeholder | min 16 chars; **generate a real one** |
| `JWT_ISSUER` / `JWT_AUDIENCE` | no | `firo.auth` / `firo.api` | |
| `JWT_ACCESS_TTL_SECONDS` | no | `900` | 15 min |
| `JWT_REFRESH_TTL_SECONDS` | no | `2592000` | 30 days |
| `CORS_ORIGINS` | no | `*` | **set explicitly in production**, e.g. `https://app.firo.com` |
| `API_BASE_URL` | no | `http://localhost:3000` | public URL, used in responses |
| `LOG_LEVEL` | no | `info` | |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Build and run

```bash
docker build -t firo-backend:latest .

docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="<your-generated-secret>" \
  -e CORS_ORIGINS="https://your-web-origin" \
  firo-backend:latest
```

Without Docker:

```bash
pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production JWT_SECRET=... node dist/main.js
```

## Health checks

`GET /health` returns an un-enveloped body (deliberately, so load balancers get
something plain and stable):

```json
{ "status": "ok", "service": "firo-backend", "version": "0.1.0", "env": "production", "uptimeSeconds": 12 }
```

Point the platform's liveness **and** readiness probes at it. The container also
declares its own `HEALTHCHECK`.

## Platform notes

Any container host works. The service binds `0.0.0.0`, reads `PORT`, and
handles `SIGTERM` (Nest shutdown hooks drain in-flight requests), which is what
most platforms require.

- **Render / Railway / Fly.io** — point at this repo, set the env vars above.
  Fly needs `internal_port = 3000` in `fly.toml`.
- **AWS ECS Fargate** — the target in
  [ADR-0001](adr/0001-modular-monolith-over-microservices.md) and
  [07-platform](architecture/07-platform-security-observability.md). Task
  definition with the image, env from Secrets Manager, ALB health check `/health`.
- **Anything Kubernetes** — deliberately deferred; a single container does not
  justify a control plane yet.

## Before real users

1. **Postgres** behind the repository ports (accounts/saves/DNA stop vanishing).
2. **A real `JWT_SECRET`** from a secrets manager, never an env file in git.
3. **Explicit `CORS_ORIGINS`** — not `*`.
4. **TLS** terminated at the load balancer or platform edge.
5. **Rate limiting** at the edge; the app does not throttle yet.
6. **Log aggregation + error reporting** (Sentry) — see the observability doc.

## Verifying a deployment

```bash
BASE=https://your-api-host

curl -fsS $BASE/health
curl -fsS $BASE/v1/experiences?limit=3 | head -c 300
curl -fsS $BASE/v1/onboarding | head -c 200

# full round trip
TOKEN=$(curl -fsS -X POST $BASE/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@firo.app","password":"sup3r-secret-pw","handle":"smoke"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.tokens.accessToken")
curl -fsS $BASE/v1/feed?limit=3 -H "authorization: Bearer $TOKEN" | head -c 300
```
