# ADR-0012: One place a day, with guest accounts

**Status:** Accepted
**Date:** 2026-09-27

## Context

The first client looked like a booking app: a feed of cards to scroll. The
product owner rejected that. Firo should be a calm place that people want to
open every day, not a catalogue to browse.

The chosen direction is *One Place a Day*: each day the user gets one place,
picked for them, and nothing to buy. Around it sit three quiet views: the
place itself, the month as a quilt of days, and a map of kept places.

Two things had to change on the server for this to work.

1. **A daily pick has to be stable.** If "today" were just the top of a feed,
   it would change as the profile learned, or when the app was reopened. A
   daily ritual that changes its answer during the day feels broken.
2. **Onboarding cannot start with a sign-up form.** The four taste questions
   have to belong to someone, but asking for an email before showing anything
   is the opposite of calm.

## Decision

**Store one pick per user per local day, and start every user as a guest.**

**The daily pick** lives in `personalization.daily_picks`, keyed by
`(user_id, day)`, where `day` is the user's calendar day in their own time
zone. The first request of the day chooses it from the ranked feed and stores
it (first writer wins, so two devices opening at once agree). After that it
never changes that day. Places shown in the last 60 days are not repeated.

**Tomorrow can be steered, once.** `personalization.rhythms` holds a one-shot
"surprise me" flag, optionally aimed at a feeling ("somewhere warm"). The next
pick honours it and clears it. The World screen's question is only asked when
answering yes can actually change tomorrow.

**The server writes the words.** The greeting, the reason a place was chosen,
the month's sentence and the world's question are composed on the server
from the profile (`personalization/domain/daily.ts`), like every other piece
of product meaning (ADR-0003). The reason must never claim a pattern the
profile cannot support: a new profile says "chosen as a first guess".

**Guest accounts.** `POST /v1/auth/guest` creates a real user row with
`is_guest = true` and no email or password. `POST /v1/auth/claim` adds an
email and password *to the same row*. The user id does not change, so the
taste profile, days and kept places need no migration.

**Notification preference is stored, not delivered.** The user chooses
morning, evening, or no notifications. Sending needs push credentials, which
do not exist yet.

## The voice: curiosity, never bait

The words are written to make people want to come back, using a few
well-understood effects. Each has a limit, because a calm product that lies
to create suspense stops being calm.

| Technique | Where | The limit |
|---|---|---|
| **Curiosity gap:** partial information makes the missing part feel urgent | Arrive: the greeting, then up to three clues (local time there, latitude or altitude, season), then "tap to see where" | Every clue is computed from the place's data. No weather, crowds or colour of light we cannot know. Never the name. |
| **Open loop:** an unfinished story is remembered better than a finished one | The end of "there's more to this place": *Tomorrow's place hasn't been chosen yet. What you keep today is part of how it will be.* | Only claims what is true: keeping does shape the profile. A requested surprise is named, nothing else is promised. |
| **Goal gradient:** a near, named finish line pulls harder than a vague one | Days: *Three more days, and this month will start to say something about you.* World: *Keep two more places, and your map will have a question for you.* | The countdown matches the rule exactly: at four days there is a sentence, and at three kept places there is always a question. |
| **Self-discovery:** people are most curious about themselves | Forming (*it will know things about you that you never said*), onboarding subtitles (*There's no wrong answer. There is a telling one.*) | No invented statistics or social proof ("most people…"). |
| **Withheld reveal:** the photograph is earned by a tap | Arrive, on the first day too | The user can always skip straight past it with one tap. |

No streaks, no counters of missed days, no "don't lose your progress". Firo
invites; it never nags.

## Consequences

- Guest rows accumulate. Abandoned guests (no activity for a long time) should
  be pruned by a scheduled job; the partial index on `created_at WHERE
  is_guest` exists for that. Not built yet.
- `POST /v1/auth/guest` is public and creates a row per call. It needs rate
  limiting before a public launch.
- A claimed email that already belongs to another account is refused with
  `identity.email_taken`. Merging two profiles is deliberately not supported.
- The feed endpoint still exists for other clients; the daily views are built
  on top of it, not in place of it.
