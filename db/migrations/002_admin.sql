-- Admin console support.
--
-- Two things: indexes for the aggregate queries the console runs, and an audit
-- log. The audit log is not optional — the moment a human can edit published
-- content or change someone's roles from a web page, "who changed this, when,
-- and what did it look like before" stops being a nice-to-have.

CREATE SCHEMA IF NOT EXISTS admin;

-- ------------------------------------------------------------- indexes -----

-- Signup charts and the user list both order by recency.
CREATE INDEX IF NOT EXISTS users_created_idx ON identity.users (created_at DESC);

-- "How many people saved this experience" — the console's most common
-- aggregate, and the one the catalogue list sorts by.
CREATE INDEX IF NOT EXISTS collection_items_experience_idx
  ON discovery.collection_items (experience_id);

-- The live activity stream reads the newest signals across all users, which
-- the existing per-user index cannot serve.
CREATE INDEX IF NOT EXISTS signals_recent_idx
  ON personalization.signals (occurred_at DESC);

-- ----------------------------------------------------------- audit log -----

CREATE TABLE IF NOT EXISTS admin.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  actor_handle text NOT NULL,          -- denormalised: survives the actor being renamed
  action       text NOT NULL,          -- 'experience.updated', 'user.suspended', ...
  target_type  text NOT NULL,          -- 'experience' | 'user' | 'place'
  target_id    text,
  -- The row as it was and as it became. Enough to answer "what did this look
  -- like yesterday" without a full temporal table.
  before       jsonb,
  after        jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON admin.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON admin.audit_log (target_type, target_id);
