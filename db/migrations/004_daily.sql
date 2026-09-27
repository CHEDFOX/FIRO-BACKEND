-- The daily ritual: one place a day, guest accounts, and the user's rhythm.

-- ------------------------------------------------------------ guests -------

-- A guest is a real account with no credentials yet. Onboarding runs before
-- anyone is asked to sign up, so the taste profile has to belong to someone
-- from the first tap. Claiming the account later fills in email and password on
-- the SAME row: the id never changes, so the DNA, keeps and daily history carry
-- over without a merge.
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- Abandoned guests are pruned by age; this is the index that sweep reads.
CREATE INDEX IF NOT EXISTS users_guest_created_idx
  ON identity.users (created_at) WHERE is_guest;

-- ------------------------------------------------------- daily picks -------

-- The one place chosen for a user on a given day.
--
-- Stored rather than recomputed because the choice must hold for the whole
-- day. Ranking depends on the taste profile, and the profile changes the moment
-- the user keeps something — so a recomputed pick would change under them on
-- the next open, which is exactly the restlessness this product exists to
-- avoid.
CREATE TABLE IF NOT EXISTS personalization.daily_picks (
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  -- The user's LOCAL calendar day. A pick made at 23:30 in Oslo belongs to that
  -- Oslo evening, not to the UTC date it happens to be.
  day            date NOT NULL,
  experience_id  text NOT NULL REFERENCES catalog.experiences(id) ON DELETE CASCADE,
  reason         text,
  is_wildcard    boolean NOT NULL DEFAULT false,
  chosen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- "What has this user been shown recently" — the no-repeat rule reads this.
CREATE INDEX IF NOT EXISTS daily_picks_user_recent_idx
  ON personalization.daily_picks (user_id, day DESC);

-- ------------------------------------------------------------ rhythm -------

-- When the user wants their place, and whether tomorrow should surprise them.
CREATE TABLE IF NOT EXISTS personalization.rhythms (
  user_id           uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  mode              text NOT NULL DEFAULT 'none'
                      CHECK (mode IN ('morning', 'evening', 'none')),
  -- Local wall-clock time of the daily note, e.g. 07:30. Null when mode is none.
  notify_at         time,
  timezone          text NOT NULL DEFAULT 'UTC',
  -- One-shot: set when the user says "surprise me tomorrow", cleared by the
  -- pick that honours it.
  surprise_next     boolean NOT NULL DEFAULT false,
  -- Optional direction for that surprise, as a taste tag ('warm'). This is what
  -- makes "Shall tomorrow be somewhere warm?" a promise the pick can keep,
  -- rather than a generic shuffle wearing a specific sentence.
  surprise_toward   text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
