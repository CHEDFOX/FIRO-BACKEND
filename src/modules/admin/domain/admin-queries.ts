import type { Experience } from '../../catalog/domain/experience';
import type { Tag } from '../../catalog/domain/taxonomy';
import type { Role } from '../../identity/domain/role';
import type { UserStatus } from '../../identity/domain/user';
import type { ExplorerDna } from '../../personalization/domain/explorer-dna';

/**
 * The admin console's read model.
 *
 * ARCHITECTURAL NOTE — this is a deliberate, documented exception.
 *
 * Every other module reads only its own schema through its own port. The admin
 * console cannot: a single row of its user table is identity + personalization
 * + discovery joined together, and composing that from four ports means a query
 * per user per screen. So admin owns a *read model* (the query side of CQRS):
 * one port, whose Postgres adapter reads across schemas in SQL, and whose
 * in-memory adapter composes the in-memory repositories.
 *
 * The rule that survives is the important one: **this port never writes.**
 * Changing an experience goes through CatalogWriter, changing a user goes
 * through UserRepository — the modules that own those invariants. If a write
 * ever appears on this interface, the boundary has been lost.
 */

// ------------------------------------------------------------- overview ----

export interface DayCount {
  /** YYYY-MM-DD, UTC. */
  readonly day: string;
  readonly count: number;
}

export interface TagPopularity {
  readonly tag: Tag;
  /** Mean net evidence across profiles — positive means the population likes it. */
  readonly net: number;
  /** How many profiles hold an opinion on this tag at all. */
  readonly profiles: number;
}

export interface SavedExperienceCount {
  readonly experienceId: string;
  readonly title: string;
  readonly saves: number;
}

export interface AdminOverview {
  readonly users: {
    readonly total: number;
    readonly newLast7d: number;
    readonly activeLast7d: number;
    readonly suspended: number;
  };
  readonly content: {
    readonly experiences: number;
    readonly published: number;
    readonly draft: number;
    readonly archived: number;
    readonly places: number;
    readonly countries: number;
  };
  readonly engagement: {
    readonly saves: number;
    readonly signals: number;
    readonly signalsLast24h: number;
    readonly dnaProfiles: number;
  };
  /** Last 30 days, oldest first, zero-filled. */
  readonly signupsByDay: readonly DayCount[];
  readonly signalsByDay: readonly DayCount[];
  readonly topTags: readonly TagPopularity[];
  readonly topSaved: readonly SavedExperienceCount[];
}

// ---------------------------------------------------------------- users ----

export interface AdminUserRow {
  readonly id: string;
  readonly handle: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly roles: readonly Role[];
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly saveCount: number;
  readonly signalCount: number;
  /** 0..1 — how much of the taste profile we actually have confidence in. */
  readonly dnaCompleteness: number;
  readonly topTags: readonly Tag[];
  readonly lastActiveAt: string | null;
}

export interface AdminUserQuery {
  readonly limit: number;
  readonly offset: number;
  /** Matches handle, email or display name, case-insensitively. */
  readonly search?: string;
  readonly status?: UserStatus;
  readonly role?: Role;
}

export interface AdminUserPage {
  readonly rows: readonly AdminUserRow[];
  readonly total: number;
}

export interface AdminSavedRow {
  readonly experienceId: string;
  readonly title: string;
  readonly placeName: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly savedAt: string;
}

export interface AdminSignalRow {
  readonly kind: string;
  readonly experienceId: string | null;
  readonly title: string | null;
  readonly durationMs: number | null;
  readonly occurredAt: string;
}

export interface AdminUserDetail {
  readonly user: AdminUserRow;
  readonly dna: ExplorerDna | null;
  readonly saves: readonly AdminSavedRow[];
  readonly recentSignals: readonly AdminSignalRow[];
}

// -------------------------------------------------------------- content ----

export interface AdminContentRow {
  readonly experience: Experience;
  readonly placeName: string | null;
  readonly countryCode: string | null;
  readonly saveCount: number;
}

export interface AdminContentQuery {
  readonly limit: number;
  readonly offset: number;
  /** Matches title, slug or summary. */
  readonly search?: string;
  readonly status?: Experience['status'];
}

export interface AdminContentPage {
  readonly rows: readonly AdminContentRow[];
  readonly total: number;
}

// --------------------------------------------------------------- places ----

/**
 * Places, for the content editor.
 *
 * An experience must belong to a real place, so the editor offers a list
 * rather than a free-text field — a form that lets you type a place id is a
 * form that lets you create an orphan.
 */
export interface AdminPlaceRow {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly regionName: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly experienceCount: number;
}

// ------------------------------------------------------------- activity ----

export type ActivityKind = 'signup' | 'save' | 'signal';

export interface AdminActivityEvent {
  /** Sortable, stable within a kind — used as the stream cursor. */
  readonly at: string;
  readonly kind: ActivityKind;
  readonly userId: string;
  readonly handle: string;
  /** Pre-rendered human line, e.g. "saved Lofoten in the blue hour". */
  readonly label: string;
  readonly experienceId: string | null;
}

// ------------------------------------------------------------------ map ----

export interface AdminMapPoint {
  readonly experienceId: string;
  readonly title: string;
  readonly lat: number;
  readonly lng: number;
  readonly saves: number;
  readonly status: Experience['status'];
  readonly tags: readonly Tag[];
}

// ----------------------------------------------------------------- port ----

export interface AdminQueries {
  overview(now: Date): Promise<AdminOverview>;
  listUsers(query: AdminUserQuery): Promise<AdminUserPage>;
  userDetail(userId: string): Promise<AdminUserDetail | null>;
  listContent(query: AdminContentQuery): Promise<AdminContentPage>;
  listPlaces(): Promise<readonly AdminPlaceRow[]>;
  /** Newest-first events strictly after `since` (ISO-8601). */
  activitySince(since: string, limit: number): Promise<readonly AdminActivityEvent[]>;
  mapPoints(): Promise<readonly AdminMapPoint[]>;
}

export const ADMIN_QUERIES = Symbol('ADMIN_QUERIES');
