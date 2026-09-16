# ADR-0011: Images on the VPS's own disk, served by nginx

**Status:** Accepted
**Date:** 2026-09-16

## Context

Firo's premise is "inspire first". A travel discovery feed without photographs
cannot inspire anyone, so images are not a feature of this product — they are
most of it. Until now the catalogue carried `https://media.firo.app/seed/*.jpg`,
a domain that does not exist; it went unnoticed only because no client actually
requested those URLs.

Something had to hold the bytes. The options were object storage with a CDN
(Cloudflare R2, Bunny) or the VPS that already runs the API.

## Decision

**The VPS's own disk, served by nginx, behind Cloudflare's free tier.**

The initial recommendation was R2. That was wrong, or at least premature: the
thing object storage really buys at this stage is edge caching, and putting
Cloudflare's free plan in front of the VPS buys the same thing for nothing. The
remaining differences — durability and bandwidth headroom — matter at a scale
this project is not at, and both are addressable later without changing a URL.

Three design choices make the local disk safe rather than merely cheap:

**1. Content-addressed, immutable paths.** A file is stored under the SHA-256 of
its bytes: `ab/cd/<hash>-800.webp`. So

- the same photograph uploaded twice is stored once;
- a URL's contents can never change, which makes
  `Cache-Control: public, max-age=31536000, immutable` honest rather than
  optimistic;
- a CDN in front never needs invalidating, and neither does a browser cache;
- the off-site backup can be an incremental `rclone copy` instead of a nightly
  tarball, because a file that exists is already final.

**2. Derivatives at upload, never on request.** Three widths (400 / 800 / 1600)
are generated when the image is uploaded. Resizing on request looks convenient
until one popular card resizes the same source for five hundred people at once
and a single VPS falls over. The CPU is spent once, by an admin who is already
waiting for a form to submit. WebP only: universally supported since 2020, and
a parallel JPEG ladder would double storage to serve browsers no user has.

**3. A free-space floor.** Uploads are refused below `MEDIA_MIN_FREE_BYTES`
(2 GB by default). On a single VPS the images share a physical disk with
Postgres, and a disk filled by a careless bulk upload is not a failed upload —
it is a database that cannot write its WAL and an application that is simply
down. Failing the upload is the cheap outcome, so the check is mandatory rather
than advisory, and a storage adapter that cannot determine free space reports
zero.

**nginx serves the bytes.** Node is never in the path of an image in
production; the API's `/media/*` route exists only so the app is complete in
development and on a first deploy. The route is deliberately **outside** the
`/v1` prefix so the path is identical whether the API or nginx answers it —
that URL is written into the database when a photo is attached, and it must not
change the day a reverse proxy goes in front.

## Consequences

**Good**

- Costs nothing beyond the VPS already running.
- No new vendor, no credentials to manage, no egress bill to model.
- The whole pipeline is testable locally: the e2e suite uploads real bytes
  through the real encoder into a temporary directory.
- `MediaStorage` is a port, so object storage later replaces one adapter and no
  URL shape, use case or client changes.

**Bad, accepted**

- **Durability is the VPS's disk.** A dead disk loses the images unless the
  off-site sync ran. That sync is therefore not optional, and it is the reason
  `scripts/backup.sh` now handles media as well as the database.
- **Bandwidth is the VPS's.** An image-heavy feed is roughly 3 MB per session;
  a few TB a month covers hundreds of thousands of sessions and no more.
  Cloudflare in front absorbs most of it, but the ceiling is real and will be
  the first thing to force a move.
- **Latency without a CDN is one location.** Someone in Singapore loading from
  a European VPS waits 200–300 ms per image. Cloudflare's free plan is the
  answer and should be turned on at the same time as the domain, not later.
- **Originals are kept and never served.** They exist so the variant ladder can
  be regenerated if the design ever wants different widths. That roughly
  doubles storage for a curated catalogue, which is cheap insurance for a
  content business and would not be for user-generated uploads at volume.

## Revisit when

Any one of: monthly image egress approaches the VPS's included bandwidth; the
catalogue passes ~50 GB; or users can upload their own photographs, at which
point the volume and the abuse surface both change character and object storage
earns its cost.
