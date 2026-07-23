# ADR-0007: Explorer DNA evolves asynchronously

- **Status:** Accepted (Phase 1)

## Context
The brief says "every interaction updates the profile." Implemented as a
synchronous write per interaction, this puts a write on the read hot path and
makes DNA the system's scaling bottleneck (the behavioral firehose is the
highest-volume stream in the product).

## Decision
Keep the **semantic guarantee** (every interaction influences DNA) but implement
it **asynchronously**:

1. The client/API emits a **typed behavioral event** to a durable log/queue.
2. A `worker` folds events into the user's **interest vector** with **decay +
   confidence**, writing the **derived `dna_profile` snapshot** in Postgres.
3. The reco funnel reads the snapshot — never raw events on the hot path.

The raw firehose does **not** land in the OLTP hot path at scale (see
[../RISKS.md](../RISKS.md)); only the derived snapshot + a small recent window do.

## Rationale
- Removes write amplification from the request path.
- Decay keeps DNA reflecting *current* taste; confidence supports cold-start
  (seeded at onboarding, rising with behavior).
- An **interpretable fixed taxonomy** (~24 named dims with score/confidence),
  not an opaque embedding, lets us explain "why" and debug the model.

## Consequences
- (+) Scales; explainable; ML-swappable behind stable interfaces.
- (−) DNA is eventually-consistent (seconds), not instant. Accepted — recommendations
  do not require sub-second profile freshness.

## Alternatives rejected
- **Synchronous per-interaction DNA writes:** scaling bottleneck; rejected.
- **Opaque learned user embedding only:** not explainable; deferred behind the
  same interfaces for a later ML phase.
