import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { Experience, ExperienceStatus, MediaRef } from '../../../catalog/domain/experience';
import type { BudgetBand, Tag } from '../../../catalog/domain/taxonomy';
import type { Role } from '../../../identity/domain/role';
import type { UserStatus } from '../../../identity/domain/user';
import type { DnaVector, ExplorerDna } from '../../../personalization/domain/explorer-dna';
import {
  daysAgo,
  denseDailySeries,
  populationTaste,
  profileCompleteness,
  strongestTags,
  TREND_DAYS,
} from '../../domain/admin-metrics';
import type {
  AdminActivityEvent,
  AdminContentPage,
  AdminContentQuery,
  AdminMapPoint,
  AdminOverview,
  AdminPlaceRow,
  AdminQueries,
  AdminUserDetail,
  AdminUserPage,
  AdminUserQuery,
  AdminUserRow,
} from '../../domain/admin-queries';

/**
 * The admin read model in SQL.
 *
 * Reads across all four schemas — the documented exception described on the
 * AdminQueries port. Per-row counts are correlated subqueries rather than
 * joins against pre-aggregated tables, so Postgres only computes them for the
 * rows that survive the LIMIT.
 */

interface UserRowSql {
  id: string;
  handle: string;
  email: string | null;
  display_name: string | null;
  roles: string[];
  status: string;
  created_at: Date;
  save_count: string;
  signal_count: string;
  last_active_at: Date | null;
  dimensions: DnaVector | null;
  dna_signal_count: number | null;
  dna_updated_at: Date | null;
  dna_version: string | null;
}

const USER_SELECT = `
  u.id, u.handle, u.email, u.display_name, u.roles, u.status, u.created_at,
  (SELECT count(*) FROM discovery.collection_items ci WHERE ci.user_id = u.id)::text
    AS save_count,
  (SELECT count(*) FROM personalization.signals s WHERE s.user_id = u.id)::text
    AS signal_count,
  -- The later of the two things a user can do. Saves alone would miss a
  -- browsing session; signals alone would miss a client that only saves.
  GREATEST(
    (SELECT max(s.occurred_at) FROM personalization.signals s WHERE s.user_id = u.id),
    (SELECT max(ci.saved_at) FROM discovery.collection_items ci WHERE ci.user_id = u.id)
  ) AS last_active_at,
  d.dimensions,
  d.signal_count AS dna_signal_count,
  d.updated_at   AS dna_updated_at,
  d.version::text AS dna_version
`;

/**
 * Cap on profiles pulled into memory to compute population taste.
 *
 * The score formula lives in the domain (and is shrinkage-weighted), so
 * reimplementing it in SQL would give two subtly different answers in the two
 * storage modes. Sampling instead: past a few thousand profiles the population
 * mean is settled, and this becomes a proper materialised view.
 */
const TASTE_SAMPLE_LIMIT = 5000;

@Injectable()
export class PostgresAdminQueries implements AdminQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async overview(now: Date): Promise<AdminOverview> {
    const since7d = daysAgo(now, 7);
    const since24h = daysAgo(now, 1);
    const trendStart = daysAgo(now, TREND_DAYS);

    const [users, content, engagement, signups, signals, profiles, topSaved] = await Promise.all([
      this.db.queryOne<{ total: string; new7d: string; active7d: string; suspended: string }>(
        `SELECT
           (SELECT count(*) FROM identity.users)::text AS total,
           (SELECT count(*) FROM identity.users WHERE created_at >= $1)::text AS new7d,
           -- Active = did anything, same definition as last_active_at.
           (SELECT count(*) FROM (
              SELECT user_id FROM personalization.signals WHERE occurred_at >= $1
              UNION
              SELECT user_id FROM discovery.collection_items WHERE saved_at >= $1
            ) AS active)::text AS active7d,
           (SELECT count(*) FROM identity.users WHERE status = 'suspended')::text AS suspended`,
        [since7d],
      ),
      this.db.queryOne<{
        experiences: string;
        published: string;
        draft: string;
        archived: string;
        places: string;
        countries: string;
      }>(
        `SELECT
           count(*)::text AS experiences,
           count(*) FILTER (WHERE status = 'published')::text AS published,
           count(*) FILTER (WHERE status = 'draft')::text AS draft,
           count(*) FILTER (WHERE status = 'archived')::text AS archived,
           (SELECT count(*) FROM catalog.places)::text AS places,
           (SELECT count(*) FROM catalog.countries)::text AS countries
         FROM catalog.experiences`,
      ),
      this.db.queryOne<{ saves: string; signals: string; signals24h: string; profiles: string }>(
        `SELECT
           (SELECT count(*) FROM discovery.collection_items)::text AS saves,
           (SELECT count(*) FROM personalization.signals)::text AS signals,
           (SELECT count(*) FROM personalization.signals WHERE occurred_at >= $1)::text
             AS signals24h,
           (SELECT count(*) FROM personalization.dna_profiles)::text AS profiles`,
        [since24h],
      ),
      this.db.query<{ day: string; count: string }>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::text
         FROM identity.users WHERE created_at >= $1 GROUP BY 1`,
        [trendStart],
      ),
      this.db.query<{ day: string; count: string }>(
        `SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::text
         FROM personalization.signals WHERE occurred_at >= $1 GROUP BY 1`,
        [trendStart],
      ),
      this.db.query<{ user_id: string; dimensions: DnaVector }>(
        `SELECT user_id, dimensions FROM personalization.dna_profiles LIMIT $1`,
        [TASTE_SAMPLE_LIMIT],
      ),
      this.db.query<{ experience_id: string; title: string; saves: string }>(
        `SELECT ci.experience_id, e.title, count(*)::text AS saves
         FROM discovery.collection_items ci
         JOIN catalog.experiences e ON e.id = ci.experience_id
         GROUP BY ci.experience_id, e.title
         ORDER BY count(*) DESC
         LIMIT 10`,
      ),
    ]);

    const sampledProfiles: ExplorerDna[] = profiles.map((row) => ({
      userId: row.user_id,
      dimensions: row.dimensions ?? {},
      signalCount: 0,
      updatedAt: now.toISOString(),
      version: 0,
    }));

    return {
      users: {
        total: Number(users?.total ?? 0),
        newLast7d: Number(users?.new7d ?? 0),
        activeLast7d: Number(users?.active7d ?? 0),
        suspended: Number(users?.suspended ?? 0),
      },
      content: {
        experiences: Number(content?.experiences ?? 0),
        published: Number(content?.published ?? 0),
        draft: Number(content?.draft ?? 0),
        archived: Number(content?.archived ?? 0),
        places: Number(content?.places ?? 0),
        countries: Number(content?.countries ?? 0),
      },
      engagement: {
        saves: Number(engagement?.saves ?? 0),
        signals: Number(engagement?.signals ?? 0),
        signalsLast24h: Number(engagement?.signals24h ?? 0),
        dnaProfiles: Number(engagement?.profiles ?? 0),
      },
      signupsByDay: denseDailySeries(toDayMap(signups), now),
      signalsByDay: denseDailySeries(toDayMap(signals), now),
      topTags: populationTaste(sampledProfiles),
      topSaved: topSaved.map((row) => ({
        experienceId: row.experience_id,
        title: row.title,
        saves: Number(row.saves),
      })),
    };
  }

  async listUsers(query: AdminUserQuery): Promise<AdminUserPage> {
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];

    if (query.search) {
      params.push(`%${query.search}%`);
      const index = params.length;
      where.push(
        `(u.handle ILIKE $${index} OR u.email::text ILIKE $${index} OR u.display_name ILIKE $${index})`,
      );
    }
    if (query.status) {
      params.push(query.status);
      where.push(`u.status = $${params.length}`);
    }
    if (query.role) {
      params.push(query.role);
      where.push(`$${params.length} = ANY(u.roles)`);
    }

    const filter = where.join(' AND ');

    const totalRow = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM identity.users u WHERE ${filter}`,
      params,
    );

    params.push(query.limit, query.offset);
    const rows = await this.db.query<UserRowSql>(
      `SELECT ${USER_SELECT}
       FROM identity.users u
       LEFT JOIN personalization.dna_profiles d ON d.user_id = u.id
       WHERE ${filter}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { rows: rows.map(toUserRow), total: Number(totalRow?.count ?? 0) };
  }

  async userDetail(userId: string): Promise<AdminUserDetail | null> {
    const row = await this.db.queryOne<UserRowSql>(
      `SELECT ${USER_SELECT}
       FROM identity.users u
       LEFT JOIN personalization.dna_profiles d ON d.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (!row) {
      return null;
    }

    const [saves, signals] = await Promise.all([
      this.db.query<{
        experience_id: string;
        title: string;
        place_name: string | null;
        lat: number;
        lng: number;
        saved_at: Date;
      }>(
        `SELECT ci.experience_id, e.title, p.name AS place_name, e.lat, e.lng, ci.saved_at
         FROM discovery.collection_items ci
         JOIN catalog.experiences e ON e.id = ci.experience_id
         LEFT JOIN catalog.places p ON p.id = e.place_id
         WHERE ci.user_id = $1
         ORDER BY ci.saved_at DESC`,
        [userId],
      ),
      this.db.query<{
        kind: string;
        experience_id: string | null;
        title: string | null;
        duration_ms: number | null;
        occurred_at: Date;
      }>(
        `SELECT s.kind, s.experience_id, e.title, s.duration_ms, s.occurred_at
         FROM personalization.signals s
         LEFT JOIN catalog.experiences e ON e.id = s.experience_id
         WHERE s.user_id = $1
         ORDER BY s.occurred_at DESC
         LIMIT 60`,
        [userId],
      ),
    ]);

    return {
      user: toUserRow(row),
      dna: toDna(row),
      saves: saves.map((save) => ({
        experienceId: save.experience_id,
        title: save.title,
        placeName: save.place_name,
        lat: save.lat,
        lng: save.lng,
        savedAt: save.saved_at.toISOString(),
      })),
      recentSignals: signals.map((signal) => ({
        kind: signal.kind,
        experienceId: signal.experience_id,
        title: signal.title,
        durationMs: signal.duration_ms,
        occurredAt: signal.occurred_at.toISOString(),
      })),
    };
  }

  async listContent(query: AdminContentQuery): Promise<AdminContentPage> {
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];

    if (query.search) {
      params.push(`%${query.search}%`);
      const index = params.length;
      where.push(
        `(e.title ILIKE $${index} OR e.slug::text ILIKE $${index} OR e.summary ILIKE $${index})`,
      );
    }
    if (query.status) {
      params.push(query.status);
      where.push(`e.status = $${params.length}`);
    }

    const filter = where.join(' AND ');

    const totalRow = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM catalog.experiences e WHERE ${filter}`,
      params,
    );

    params.push(query.limit, query.offset);
    const rows = await this.db.query<
      ExperienceRowSql & { place_name: string | null; country_code: string | null; saves: string }
    >(
      `SELECT e.id, e.place_id, e.slug, e.title, e.summary, e.story, e.lat, e.lng, e.tags,
              e.budget_band, e.season_mask, e.difficulty, e.wow_score, e.hidden_gem_score,
              e.media, e.status, e.created_at, e.updated_at,
              p.name AS place_name, c.code AS country_code,
              (SELECT count(*) FROM discovery.collection_items ci
                 WHERE ci.experience_id = e.id)::text AS saves
       FROM catalog.experiences e
       LEFT JOIN catalog.places p ON p.id = e.place_id
       LEFT JOIN catalog.countries c ON c.id = p.country_id
       WHERE ${filter}
       ORDER BY e.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      total: Number(totalRow?.count ?? 0),
      rows: rows.map((row) => ({
        experience: toExperience(row),
        placeName: row.place_name,
        countryCode: row.country_code,
        saveCount: Number(row.saves),
      })),
    };
  }

  async listPlaces(): Promise<readonly AdminPlaceRow[]> {
    const rows = await this.db.query<{
      id: string;
      name: string;
      country_code: string | null;
      country_name: string | null;
      region_name: string | null;
      lat: number;
      lng: number;
      experience_count: string;
    }>(
      `SELECT p.id, p.name, c.code AS country_code, c.name AS country_name,
              r.name AS region_name, p.lat, p.lng,
              (SELECT count(*) FROM catalog.experiences e WHERE e.place_id = p.id)::text
                AS experience_count
       FROM catalog.places p
       LEFT JOIN catalog.countries c ON c.id = p.country_id
       LEFT JOIN catalog.regions r ON r.id = p.region_id
       ORDER BY p.name`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      countryCode: row.country_code,
      countryName: row.country_name,
      regionName: row.region_name,
      lat: row.lat,
      lng: row.lng,
      experienceCount: Number(row.experience_count),
    }));
  }

  async activitySince(since: string, limit: number): Promise<readonly AdminActivityEvent[]> {
    const rows = await this.db.query<{
      at: Date;
      kind: string;
      user_id: string;
      handle: string;
      label: string;
      experience_id: string | null;
    }>(
      `(
         SELECT u.created_at AS at, 'signup' AS kind, u.id AS user_id, u.handle::text AS handle,
                'joined Firo' AS label, NULL::text AS experience_id
         FROM identity.users u
         WHERE u.created_at > $1
       )
       UNION ALL
       (
         SELECT ci.saved_at AS at, 'save' AS kind, ci.user_id, u.handle::text,
                'saved ' || e.title AS label, ci.experience_id
         FROM discovery.collection_items ci
         JOIN identity.users u ON u.id = ci.user_id
         JOIN catalog.experiences e ON e.id = ci.experience_id
         WHERE ci.saved_at > $1
       )
       UNION ALL
       (
         SELECT s.occurred_at AS at, 'signal' AS kind, s.user_id, u.handle::text,
                s.kind || ' ' || COALESCE(e.title, '') AS label, s.experience_id
         FROM personalization.signals s
         JOIN identity.users u ON u.id = s.user_id
         LEFT JOIN catalog.experiences e ON e.id = s.experience_id
         WHERE s.occurred_at > $1
       )
       ORDER BY at DESC
       LIMIT $2`,
      [since, limit],
    );

    return rows.map((row) => ({
      at: row.at.toISOString(),
      kind: row.kind as AdminActivityEvent['kind'],
      userId: row.user_id,
      handle: row.handle,
      label: row.label.trim(),
      experienceId: row.experience_id,
    }));
  }

  async mapPoints(): Promise<readonly AdminMapPoint[]> {
    const rows = await this.db.query<{
      id: string;
      title: string;
      lat: number;
      lng: number;
      status: string;
      tags: string[];
      saves: string;
    }>(
      `SELECT e.id, e.title, e.lat, e.lng, e.status, e.tags,
              (SELECT count(*) FROM discovery.collection_items ci
                 WHERE ci.experience_id = e.id)::text AS saves
       FROM catalog.experiences e`,
    );

    return rows.map((row) => ({
      experienceId: row.id,
      title: row.title,
      lat: row.lat,
      lng: row.lng,
      saves: Number(row.saves),
      status: row.status as ExperienceStatus,
      tags: row.tags as Tag[],
    }));
  }
}

// --------------------------------------------------------------- mapping ----

interface ExperienceRowSql {
  id: string;
  place_id: string;
  slug: string;
  title: string;
  summary: string;
  story: string | null;
  lat: number;
  lng: number;
  tags: string[];
  budget_band: string;
  season_mask: number;
  difficulty: number;
  wow_score: number;
  hidden_gem_score: number;
  media: MediaRef[];
  status: string;
  created_at: Date;
  updated_at: Date;
}

function toExperience(row: ExperienceRowSql): Experience {
  return {
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    story: row.story,
    coordinates: { lat: row.lat, lng: row.lng },
    tags: row.tags as Tag[],
    budgetBand: row.budget_band as BudgetBand,
    seasonMask: row.season_mask,
    difficulty: row.difficulty,
    wowScore: row.wow_score,
    hiddenGemScore: row.hidden_gem_score,
    media: row.media ?? [],
    status: row.status as ExperienceStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDna(row: UserRowSql): ExplorerDna | null {
  if (!row.dimensions) {
    return null;
  }
  return {
    userId: row.id,
    dimensions: row.dimensions,
    signalCount: row.dna_signal_count ?? 0,
    updatedAt: (row.dna_updated_at ?? row.created_at).toISOString(),
    version: Number(row.dna_version ?? 0),
  };
}

function toUserRow(row: UserRowSql): AdminUserRow {
  const dna = toDna(row);
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles as Role[],
    status: row.status as UserStatus,
    createdAt: row.created_at.toISOString(),
    saveCount: Number(row.save_count),
    signalCount: Number(row.signal_count),
    dnaCompleteness: profileCompleteness(dna),
    topTags: strongestTags(dna),
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
  };
}

function toDayMap(rows: readonly { day: string; count: string }[]): Map<string, number> {
  return new Map(rows.map((row) => [row.day, Number(row.count)]));
}
