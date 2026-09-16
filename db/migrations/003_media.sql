-- Media assets.
--
-- The bytes live on disk (content-addressed, served by nginx); this table is
-- the registry of what exists, so the console can browse and reuse uploads and
-- so orphaned files can be swept. Images are never stored in Postgres: a
-- database holding blobs makes every backup enormous and every restore slow,
-- for data that a filesystem serves better.

CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE IF NOT EXISTS media.assets (
  id                     uuid PRIMARY KEY,
  -- The storage key and the dedupe key. Unique: the same photo uploaded twice
  -- is the same asset, not two rows pointing at one file.
  sha256                 char(64) NOT NULL UNIQUE,
  original_filename      text,
  original_content_type  text NOT NULL,
  original_bytes         bigint NOT NULL CHECK (original_bytes > 0),
  original_path          text NOT NULL,
  width                  integer NOT NULL CHECK (width > 0),
  height                 integer NOT NULL CHECK (height > 0),
  -- Sampled from the image itself, so the client can paint a matching block
  -- while the photograph loads instead of a grey rectangle.
  dominant_color         char(7) NOT NULL,
  -- The generated ladder: [{ width, height, bytes, path }]. JSONB because it
  -- is an ordered list of value objects with no independent lifecycle, always
  -- read with its parent.
  variants               jsonb NOT NULL DEFAULT '[]',
  attribution            text,
  alt                    text,
  uploaded_by            uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_created_idx ON media.assets (created_at DESC);
CREATE INDEX IF NOT EXISTS assets_uploader_idx ON media.assets (uploaded_by);

-- NOTE: there is deliberately no foreign key from catalog.experiences.media to
-- this table. Media lives inside the experience row as JSONB (the projection
-- clients read), and a hard reference would stop the catalogue from ever
-- carrying an image this module did not produce — an editorial constraint, not
-- a data one. The console checks references before deleting instead.
