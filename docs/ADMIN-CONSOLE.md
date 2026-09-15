# The Firo operator console

A private web console for running Firo: who signed up, what their Explorer DNA
looks like, what the catalogue contains, where everything is on the map, and
what is happening right now.

The UI lives in the frontend repo at `admin/`. This document covers the API it
talks to and how to get access.

---

## 1. Becoming an admin

There is **no way to grant yourself the admin role over HTTP.** Every console
route requires it, so a self-service path would be an escalation path.

### First admin — before the account exists

Set `ADMIN_EMAILS` and register normally. The listed addresses get the admin
role at sign-up.

```bash
# in .env
ADMIN_EMAILS=you@yourdomain.com
```

It only applies at registration, so it cannot promote an existing account, and
the address must be one you control.

### First admin — account already exists

```bash
docker compose exec api node dist/infrastructure/database/grant-admin.js you@yourdomain.com
# revoke:
docker compose exec api node dist/infrastructure/database/grant-admin.js them@example.com --revoke
```

This needs shell access to the server, which is the point.

### Everyone after that

From the console: **Users → open the account → Make admin**. Audited.

> Access tokens live 15 minutes and carry the roles they were minted with, so a
> promotion or revocation takes effect on the next token refresh, not instantly.
> To cut someone off immediately, suspend the account.

---

## 2. Endpoints

All under `/v1/admin`, all requiring a bearer token for an account with the
`admin` role. Anything else gets `401 auth.missing_token` or
`403 auth.insufficient_role`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/overview` | Headline counts, 30-day trends, population taste, most-saved |
| GET | `/users` | Paged accounts with saves, signals, DNA completeness (`limit`, `offset`, `search`, `status`, `role`) |
| GET | `/users/:id` | One account: full DNA, every save, recent signals |
| PUT | `/users/:id/status` | `active` \| `suspended` \| `deleted` |
| PUT | `/users/:id/roles` | Set roles |
| GET | `/content` | Paged catalogue with save counts (`limit`, `offset`, `search`, `status`) |
| POST | `/content` | Create an experience |
| PUT | `/content/:id` | Edit an experience |
| DELETE | `/content/:id` | Hard-delete an experience |
| GET | `/places` | Places, for the editor's picker |
| GET | `/map` | Every experience with coordinates, status and save count |
| GET | `/activity` | Recent signups, saves and signals (`since`, `limit`) |
| GET | `/stream` | The same as Server-Sent Events, live |
| GET | `/audit` | Every change made from the console |

Responses use the standard `{ data, meta, error }` envelope. `/stream` does not
— it is SSE, and is marked `@RawResponse()` for that reason.

### The live stream

`GET /v1/admin/stream` emits three event types:

```
event: hello       — the stream is open
event: activity    — one AdminActivityEvent, oldest-first within a batch
event: heartbeat   — nothing happened; keeps idle proxies from closing it
```

It **polls the read model every 2.5s and pushes only what is new**. A push
architecture (an event bus every use case writes to) would be tidier, but would
require threading a publisher through modules that have no idea the console
exists. This buys the live feel for zero coupling; the seam to replace it is one
method on `AdminController`.

The browser client uses `fetch` + `ReadableStream`, not `EventSource`, because
`EventSource` cannot send an `Authorization` header — the alternative is putting
an admin token in a query string, where it lands in access logs and browser
history. It falls back to polling `/activity` if streaming is blocked by a
proxy.

---

## 3. What is protected, and what is not

**Protected**

- Everything requires the `admin` role. There is no read-only tier: the console
  exposes emails, behavioural history and taste profiles for every account, so a
  partially-protected version would be worse than none.
- An admin cannot suspend themselves or remove their own admin role. Losing the
  last admin account to a misclick is unrecoverable over HTTP.
- Editorial scores are bounded 0..1 at the schema. A form that could submit 12
  would silently dominate every feed rather than fail.
- An experience must point at a real place, and slugs must be unique.
- Every change is written to `admin.audit_log` with the row before and after.

**Not protected — be aware**

- The console is a static page. Serve it somewhere private (behind basic auth,
  a VPN, or simply not deployed at all — running it locally against the
  production API works and is the recommended setup).
- `DELETE /content/:id` is a hard delete and cascades to every save that
  references the experience. The console asks for confirmation and archiving is
  the default action; the audit entry is the only way back.
- Deleting a *user* is not exposed. Status `deleted` marks the account; purging
  personal data is a GDPR workflow with its own requirements, not a button.

---

## 4. Architecture

The console is a module that sits *above* the bounded contexts:

```
AdminController
      │
      ├── reads  → AdminQueries (read model, cross-schema)  ← ADR-0010
      └── writes → CatalogWriter / UserRepository (the owning modules' ports)
```

Reading across schemas is a documented exception, explained in
[ADR-0010](adr/0010-admin-read-model.md). The rule that survives is that the
read model never writes — every mutation goes through the module that owns the
invariant.

Nothing in the product depends on the admin module; removing it changes no
user-facing behaviour.

### Storage modes

Like everything else, it works with or without a database:

| | `DATABASE_URL` set | unset |
|---|---|---|
| Read model | cross-schema SQL | scans over the in-memory repositories |
| Audit log | `admin.audit_log` | a 500-entry ring, lost on restart |

The arithmetic (affinity, confidence, completeness, dense day series) is shared
domain code called by both, so the two modes cannot disagree about a number.

---

## 5. Running it

Backend: nothing to do — the routes are part of the API.

Frontend (from the frontend repo):

```bash
cd admin
python3 -m http.server 4111
# open http://127.0.0.1:4111 and point it at your API
```

See `admin/README.md` in the frontend repo for details.
