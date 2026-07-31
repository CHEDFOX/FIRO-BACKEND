# Explorer DNA & the Personalised Feed

The heart of the product: a taste profile that learns **fast**, stays **smart**,
and can explain itself.

## Why not machine learning (yet)

With no users there is nothing to train on, and a black-box model cannot tell a
user *why* something was recommended. We ship an **interpretable** model over the
same 24-tag vocabulary the catalogue already uses — which means the very first
user gets real personalisation on their very first tap. Everything sits behind a
`Scorer` port, so a learned ranker can replace the maths later without touching
a single caller.

## The core: evidence, not a score

Each taste dimension keeps **positive** and **negative** evidence separately:

```
score      = (pos − neg) / (pos + neg + SHRINKAGE)   →  −1 … +1
confidence = (pos + neg) / (pos + neg + SHRINKAGE)   →   0 … 1
```

`SHRINKAGE` (6) is the whole trick. With thin evidence it pulls scores toward
neutral, so one stray tap cannot swing the profile; as evidence accumulates its
influence fades and scores sharpen. Cold start, confidence, and stability all
fall out of one formula.

## How it learns fast

| Technique | Effect |
|---|---|
| **Population prior** | New users start at the average profile, not blank — they only need evidence to move *away* from average |
| **Multi-tag learning** | Every experience carries ~6 tags, so one save teaches ~6 dimensions at once |
| **Tag transfer** | Correlated tags learn from each other (`cold` → `solitude`, `mountains`), so we learn about dimensions never shown |
| **Opposites** | Evidence for `solitude` is weak evidence *against* `social` |
| **Asymmetric learning rate** | Up to 2× while uncertain, decaying toward 1× once confident — fast convergence, no late whiplash |
| **Session intent** | A separate short-term layer reacts within 2–3 taps and fades in ~15 min |
| **Exploration bias** | While confidence is low the feed favours *informative* items, doubling as an efficient experiment |

Measured: a clear top taste emerges after **3 signals**; high confidence on a
dimension after roughly **6** consistent ones.

## How it stays smart

- **Exposure normalisation** — interest is discounted by how much we *showed*
  something. Otherwise the feed becomes a self-fulfilling loop: show 100
  mountains, "learn" the user likes mountains.
- **Credit dilution (`1/√n`)** — a reaction is to a *place*, not a tag. Rejecting
  a six-tag experience must not condemn all six qualities equally. Without this,
  one "not for me" produced **seven** confident dislikes; with it, the same tap
  produces soft, recoverable leanings.
- **Decay (180-day half-life)** — taste from two years ago should not outrank
  last month. The profile reflects *who you are now*.
- **Negative evidence is first-class** — a profile learned only from likes goes
  bland, because it can never rule anything out.
- **Impressions are not taste** — being shown something is evidence of *our*
  choices, not the user's preferences. Recorded for normalisation only.

## The feed

```
candidates → score (taste × wow × season × novelty) → diversity → wildcards → feed
```

- **Diversity penalty** — repeated tags are down-weighted, so the feed never
  becomes ten near-identical cards.
- **Wildcards (~1 in 6)** — a deliberate, high-quality surprise *outside* known
  taste, labelled "Something a little different". Unpredictable delight is what
  keeps a thumb moving; a perfectly predictable feed is a boring one, and this
  is also the anti-filter-bubble mechanism.
- **Reasons** — "Because you love cold, quiet places", shown only when we are
  genuinely confident. Only possible because the model is interpretable.
- **Already-saved items are excluded** — never re-sell what someone has taken.

## API

| Endpoint | Purpose |
|---|---|
| `GET /v1/feed?limit&sessionId` | The personalised feed with reasons + wildcards |
| `POST /v1/signals` | Record a behaviour (save, dwell, open, skip, not_for_me…) |
| `GET /v1/me/dna` | The user's own evolving profile + completeness |

Signal weights: `add_to_trip 4 · more_like_this 4 · save 3 · share 2 ·
onboarding_pick 2.5 · open 1 · dwell 0.5→2 (duration-scaled) · skip −0.5 ·
unsave −3 · not_for_me −5 · impression 0`.

## Deliberate limits (for now)

- **One profile per user.** Pinterest's PinnerSage shows that people hold several
  distinct tastes at once, and averaging them produces mush. Multi-cluster DNA is
  the next upgrade; the tag-transfer matrix already softens the problem.
- **Synchronous fold.** Cheap today; moves to the worker queue behind the same
  interface when volume demands it.
- **Hand-seeded tag correlations.** Should be *learned* from co-occurrence in
  real saves — a data change, not a code change.

## Status
✅ Learning engine, session intent, feed builder, API, 121 tests.
⬜ Multi-cluster DNA · learned correlations · async worker fold · Postgres.
