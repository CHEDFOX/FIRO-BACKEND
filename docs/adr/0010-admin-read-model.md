# ADR-0010: The admin console reads across schemas through its own read model

**Status:** Accepted
**Date:** 2026-09-15

## Context

Every bounded context in Firo owns its own schema and is reached only through
its own repository ports (ADR-0001, ADR-0004). That rule is what keeps a module
extractable later: nothing outside it knows how its tables are shaped.

The operator console breaks the assumption behind that rule. A single row of its
user table is:

| column | owned by |
|---|---|
| handle, email, status, roles | `identity` |
| saves | `discovery` |
| signals, last active | `personalization` |
| taste profile | `personalization` |
| titles of saved experiences | `catalog` |

Built strictly through the existing ports, one screen of fifty users is one
query for the page plus four per user — 201 round trips for a table. The ports
also have no "list everything" method, and adding one to each would widen four
public interfaces for the benefit of a single internal consumer, inviting a
product use case to enumerate accounts later.

## Options considered

1. **Add listing/aggregate methods to every existing port.** Keeps one rule, but
   pollutes four interfaces for one consumer and still produces N+1 reads in the
   in-memory adapter.
2. **Let the console query tables directly from its controller.** Fastest to
   write, and the worst outcome: SQL for four schemas spread across HTTP
   handlers, with no boundary to notice when it drifts.
3. **Give the console its own read model.** One port (`AdminQueries`) whose
   methods are the console's questions, with a Postgres adapter that answers
   each in cross-schema SQL and an in-memory adapter that composes the in-memory
   repositories.

## Decision

Option 3. The admin module owns a **read model** — the query side of CQRS —
declared as `AdminQueries` and implemented twice.

Two constraints make this safe rather than a hole in the architecture:

- **The read model never writes.** Editing an experience goes through
  `CatalogWriter`; changing an account goes through `UserRepository`. The
  modules that own an invariant remain the only place it is enforced. A write
  method appearing on `AdminQueries` means the boundary has been lost.
- **Nothing in the product depends on the admin module.** It is imported last
  in `AppModule` and exports nothing. Deleting it changes no user-facing
  behaviour — which is the test of whether the coupling actually costs anything.

Scoring functions (affinity, confidence, completeness) stay in the
personalization domain and are called by *both* adapters rather than
reimplemented in SQL, so the console and the ranker can never disagree about
what a number means.

## Consequences

**Good**

- One screen is one or two queries, not two hundred.
- Product ports stay narrow; no use case gains the ability to enumerate users.
- The two storage modes give byte-identical answers, because the arithmetic
  lives in one place.

**Bad, accepted**

- The Postgres adapter knows the physical layout of four schemas. Renaming a
  column in `identity` can break the console. Mitigation: it is one file, and
  the e2e suite covers every query.
- The in-memory adapter depends on the concrete in-memory repositories, which
  their modules now export. That is infrastructure-to-infrastructure coupling
  inside one deployable, and it exists only so the app stays fully runnable
  without a database.
- Population taste samples up to 5 000 profiles into memory. Beyond that this
  becomes a materialised view refreshed on a schedule; the port does not change
  when it does.

**If a context is ever extracted into its own service**, this is the first thing
that breaks, and deliberately so: the console would then read that service's
API instead of its tables. The read model is the single place that change lands.
