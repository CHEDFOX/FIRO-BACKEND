# The Personal World Map (3D)

A signature feature: a **dynamic 3D world map** where a user sees their own
travel universe — saved places glowing across a spinning globe, tilting into
real terrain as they zoom in.

## Why it matters
It turns saves from a list into a **place you own**. "My world" is a powerful
retention feeling: people return to see it fill in. It also makes saving
meaningful, which strengthens the single best taste signal we have.

## The split: backend decides *what*, client decides *how*

This is [ADR-0003](../adr/0003-bdui-semantics-vs-presentation-boundary.md)
applied to the map, and it is what lets the map become fully three-dimensional
**without a single backend change**.

| Backend owns (semantics) | Client owns (presentation) |
|---|---|
| Which experiences are in this viewport | Globe vs flat projection |
| How they cluster at this zoom | Camera tilt, pitch, bearing |
| Which pin represents a cluster | 3D terrain / building extrusion |
| Whether to show all places or only saves | Cinematic fly-to animation |
| Pin colour hint, title, slug | Map style, glow, day/night, gestures |

The API response is deliberately presentation-agnostic: it never says "draw a
globe." It says "here is what is here."

## The API

```
GET /v1/map?south=&west=&north=&east=&zoom=&saved=true
```

- **Optional auth**: anonymous callers get the full catalogue; a signed-in
  caller can pass `saved=true` to get *their* pins. An invalid token is still
  rejected — see `@OptionalAuth()`.
- **Response**: `clusters[]` (position, count, representative, `isSingle`),
  `pins[]` (title/slug/colour for each representative), `totalInView`,
  `truncated`.

## Clustering — the thing that keeps it smooth

Never ship thousands of raw pins to a map; it stutters and reads as noise.
Points are snapped to a **zoom-dependent grid** (`45° / 2^zoom`) and one cluster
is emitted per occupied cell, so clusters **split apart naturally as the user
zooms in**.

It is written as a **pure function** over points
(`catalog/domain/clustering.ts`), which means the Postgres adapter can later
push the identical grid maths into SQL (`floor(lng/size)`) with **no change to
the contract or the client**.

Verified behaviour (see `clustering.spec.ts`):
- Two Lofoten spots ~5 km apart → **one cluster at zoom 3**, **two pins at zoom 14**.
- Distant points never merge.
- Highest `wowScore` member becomes the cluster's representative.
- Deterministic for identical input (stable across requests/caching).

## Data prepared for 3D
- `Place.elevationMeters` — lets the client frame terrain sensibly.
- `MediaRef.dominantColor` — pin/marker tinting and tasteful loading states.
- Exact WGS-84 coordinates on every experience.
- Antimeridian-safe viewport tests (`crossesAntimeridian`), so a Pacific-centred
  globe works correctly.

## Client plan (visual phase, last)
1. **MapLibre / Mapbox** in the Flutter client — not the default road-map look.
2. **Globe projection** when zoomed out; **tilt + 3D terrain** when zoomed in.
3. **Cinematic fly-to**: tapping a pin arcs across the globe and dives in.
4. Custom premium style (calm/dark), glowing saved pins, "your world fills in"
   progress, suggestions layered onto the map.
5. Performance discipline: 3D is heavier — load terrain only on zoom-in, test on
   mid-range devices. **Smoothness over spectacle.**

## Status
- ✅ Backend viewport query + clustering + saved-only filter (tested, live).
- ⬜ Postgres/PostGIS adapter (same port; `ST_Intersects` + SQL grid).
- ⬜ Client map screen, then the 3D globe, then the premium styling.
