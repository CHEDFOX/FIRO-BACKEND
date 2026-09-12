-- Firo initial schema.
--
-- Schema-per-module, as designed in docs/architecture/04-data-architecture.md:
-- each bounded context owns its own namespace so a module can later be split
-- out without untangling shared tables.
--
-- Id conventions:
--   * user-generated rows use UUIDv7 (generated in the application so ids are
--     time-sortable and available before the insert)
--   * catalog rows use readable editorial ids ('exp_lofoten_blue_hour'), which
--     are stable slugs curated by hand, so they are text

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS discovery;
CREATE SCHEMA IF NOT EXISTS personalization;

-- citext gives case-insensitive emails/handles without lower() on every query.
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================ identity =====

CREATE TABLE identity.users (
  id              uuid PRIMARY KEY,
  handle          citext NOT NULL UNIQUE,
  email           citext UNIQUE,              -- nullable: future OAuth-only accounts
  email_verified  boolean NOT NULL DEFAULT false,
  password_hash   text,                       -- nullable for the same reason
  display_name    text,
  locale          text NOT NULL DEFAULT 'en',
  roles           text[] NOT NULL DEFAULT '{user}',
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         bigint NOT NULL DEFAULT 0
);

CREATE TABLE identity.refresh_tokens (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,
  -- Only the hash is stored: a leaked database must not yield usable tokens.
  token_hash      text NOT NULL UNIQUE,
  device_id       text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  replaced_by_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Rotation looks a token up by hash on every refresh; the family index backs
-- revoking a whole session at once (reuse detection / logout).
CREATE INDEX refresh_tokens_family_idx ON identity.refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON identity.refresh_tokens (user_id);

-- ============================================================= catalog =====

CREATE TABLE catalog.countries (
  id    text PRIMARY KEY,
  code  char(2) NOT NULL UNIQUE,              -- ISO-3166-1 alpha-2
  name  text NOT NULL,
  slug  citext NOT NULL UNIQUE
);

CREATE TABLE catalog.regions (
  id          text PRIMARY KEY,
  country_id  text NOT NULL REFERENCES catalog.countries(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        citext NOT NULL
);

CREATE INDEX regions_country_idx ON catalog.regions (country_id);

CREATE TABLE catalog.places (
  id                text PRIMARY KEY,
  country_id        text NOT NULL REFERENCES catalog.countries(id) ON DELETE CASCADE,
  region_id         text REFERENCES catalog.regions(id) ON DELETE SET NULL,
  name              text NOT NULL,
  slug              citext NOT NULL UNIQUE,
  -- Stored as plain numeric columns rather than PostGIS geometry: the geo maths
  -- currently lives in the application (haversine, grid clustering). Moving to
  -- PostGIS is a later, additive migration when queries need it in SQL.
  lat               double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  elevation_meters  integer,
  timezone          text
);

CREATE INDEX places_country_idx ON catalog.places (country_id);
-- Backs the map viewport query (a bounding-box scan over lat/lng).
CREATE INDEX places_coords_idx ON catalog.places (lat, lng);

CREATE TABLE catalog.experiences (
  id                text PRIMARY KEY,
  place_id          text NOT NULL REFERENCES catalog.places(id) ON DELETE CASCADE,
  slug              citext NOT NULL UNIQUE,
  title             text NOT NULL,
  summary           text NOT NULL,
  story             text,
  lat               double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  tags              text[] NOT NULL DEFAULT '{}',
  budget_band       text NOT NULL
                      CHECK (budget_band IN ('budget', 'moderate', 'premium', 'luxury')),
  season_mask       integer NOT NULL DEFAULT 4095,   -- 12-bit month bitmask
  difficulty        smallint NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  -- Editorial ranking signals. Never exposed to clients.
  wow_score         real NOT NULL DEFAULT 0.5 CHECK (wow_score BETWEEN 0 AND 1),
  hidden_gem_score  real NOT NULL DEFAULT 0.5 CHECK (hidden_gem_score BETWEEN 0 AND 1),
  -- Media as JSONB: an ordered list of value objects with no independent
  -- lifecycle, always read with its parent.
  media             jsonb NOT NULL DEFAULT '[]',
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX experiences_place_idx ON catalog.experiences (place_id);
CREATE INDEX experiences_status_idx ON catalog.experiences (status);
CREATE INDEX experiences_coords_idx ON catalog.experiences (lat, lng);
-- GIN makes "has any of these tags" an index lookup instead of a scan.
CREATE INDEX experiences_tags_idx ON catalog.experiences USING gin (tags);

-- =========================================================== discovery =====

CREATE TABLE discovery.collections (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        citext NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  is_private  boolean NOT NULL DEFAULT true,
  item_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collections_user_idx ON discovery.collections (user_id);
-- Exactly one default collection per user, enforced by the database rather
-- than hoped for in application code.
CREATE UNIQUE INDEX collections_one_default_per_user
  ON discovery.collections (user_id) WHERE is_default;

CREATE TABLE discovery.collection_items (
  id             uuid PRIMARY KEY,
  collection_id  uuid NOT NULL REFERENCES discovery.collections(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  experience_id  text NOT NULL REFERENCES catalog.experiences(id) ON DELETE CASCADE,
  note           text,
  saved_at       timestamptz NOT NULL DEFAULT now()
);

-- Saving is idempotent by design; this makes a double-tap impossible to
-- duplicate even under concurrent requests.
CREATE UNIQUE INDEX collection_items_unique
  ON discovery.collection_items (collection_id, experience_id);
CREATE INDEX collection_items_user_idx ON discovery.collection_items (user_id, saved_at DESC);

-- ====================================================== personalization ====

CREATE TABLE personalization.dna_profiles (
  user_id       uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  -- The interest vector: tag -> { positive, negative, exposures, updatedAt }.
  -- JSONB because the taxonomy evolves and the whole profile is always read
  -- and written together.
  dimensions    jsonb NOT NULL DEFAULT '{}',
  signal_count  integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       bigint NOT NULL DEFAULT 0
);

-- Append-only behavioural log. Deliberately has no per-row audit trail and is
-- cheap to prune; the derived profile above is what ranking actually reads.
CREATE TABLE personalization.signals (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  session_id     text,
  kind           text NOT NULL,
  experience_id  text,
  duration_ms    integer,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signals_user_idx ON personalization.signals (user_id, occurred_at DESC);
CREATE INDEX signals_occurred_idx ON personalization.signals (occurred_at);

-- NOTE: session intent is intentionally NOT stored here. It has a ~15 minute
-- half-life and exists only to bend the current session's feed, so persisting
-- it would add write load for data that is worthless within the hour. It lives
-- in process memory; losing it on restart costs a user nothing but the
-- "right now" nudge.
