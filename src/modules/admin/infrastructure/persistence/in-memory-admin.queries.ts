import { Injectable } from '@nestjs/common';
import { InMemoryCatalogRepository } from '../../../catalog/infrastructure/persistence/in-memory-catalog.repository';
import type { Experience } from '../../../catalog/domain/experience';
import type { Tag } from '../../../catalog/domain/taxonomy';
import { InMemoryCollectionItemRepository } from '../../../discovery/infrastructure/persistence/in-memory-collection.repository';
import type { Role } from '../../../identity/domain/role';
import type { User, UserStatus } from '../../../identity/domain/user';
import { InMemoryUserRepository } from '../../../identity/infrastructure/persistence/in-memory-user.repository';
import type { ExplorerDna } from '../../../personalization/domain/explorer-dna';
import {
  InMemoryDnaRepository,
  InMemorySignalRepository,
} from '../../../personalization/infrastructure/persistence/in-memory-personalization.repository';
import {
  bucketByDay,
  daysAgo,
  denseDailySeries,
  populationTaste,
  profileCompleteness,
  strongestTags,
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
 * The admin read model over in-memory storage.
 *
 * Composes the in-memory repositories directly rather than going through their
 * ports — see the note on the AdminQueries port. Everything here is a linear
 * scan, which is honest: in-memory mode holds a demo-sized dataset and the
 * Postgres adapter is what runs in production.
 */
@Injectable()
export class InMemoryAdminQueries implements AdminQueries {
  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly catalog: InMemoryCatalogRepository,
    private readonly saves: InMemoryCollectionItemRepository,
    private readonly dna: InMemoryDnaRepository,
    private readonly signals: InMemorySignalRepository,
  ) {}

  async overview(now: Date): Promise<AdminOverview> {
    const users = this.users.listAll();
    const experiences = this.catalog.listAllExperiences();
    const saves = this.saves.listAll();
    const signals = this.signals.listAll();
    const profiles = this.dna.listAll();

    const sevenDaysAgo = daysAgo(now, 7);
    const dayAgo = daysAgo(now, 1);

    // Active = did anything, the same definition as lastActiveAt.
    const activeUserIds = new Set([
      ...signals.filter((signal) => signal.occurredAt >= sevenDaysAgo).map((s) => s.userId),
      ...saves.filter((save) => save.savedAt >= sevenDaysAgo).map((save) => save.userId),
    ]);

    const savesByExperience = new Map<string, number>();
    for (const save of saves) {
      savesByExperience.set(save.experienceId, (savesByExperience.get(save.experienceId) ?? 0) + 1);
    }

    const titles = new Map(experiences.map((e) => [e.id, e.title]));

    return {
      users: {
        total: users.length,
        newLast7d: users.filter((user) => user.createdAt >= sevenDaysAgo).length,
        activeLast7d: activeUserIds.size,
        suspended: users.filter((user) => user.status === 'suspended').length,
      },
      content: {
        experiences: experiences.length,
        published: experiences.filter((e) => e.status === 'published').length,
        draft: experiences.filter((e) => e.status === 'draft').length,
        archived: experiences.filter((e) => e.status === 'archived').length,
        places: this.catalog.listAllPlaces().length,
        countries: this.catalog.listAllCountries().length,
      },
      engagement: {
        saves: saves.length,
        signals: signals.length,
        signalsLast24h: signals.filter((signal) => signal.occurredAt >= dayAgo).length,
        dnaProfiles: profiles.length,
      },
      signupsByDay: denseDailySeries(bucketByDay(users.map((user) => user.createdAt)), now),
      signalsByDay: denseDailySeries(bucketByDay(signals.map((signal) => signal.occurredAt)), now),
      topTags: populationTaste(profiles),
      topSaved: [...savesByExperience.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([experienceId, count]) => ({
          experienceId,
          title: titles.get(experienceId) ?? experienceId,
          saves: count,
        })),
    };
  }

  async listUsers(query: AdminUserQuery): Promise<AdminUserPage> {
    let rows = this.users.listAll();

    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (user) =>
          user.handle.toLowerCase().includes(needle) ||
          (user.email ?? '').toLowerCase().includes(needle) ||
          (user.displayName ?? '').toLowerCase().includes(needle),
      );
    }
    if (query.status) {
      rows = rows.filter((user) => user.status === query.status);
    }
    if (query.role) {
      rows = rows.filter((user) => user.roles.includes(query.role as Role));
    }

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = rows.length;
    const page = rows.slice(query.offset, query.offset + query.limit);

    return { rows: page.map((user) => this.toUserRow(user)), total };
  }

  async userDetail(userId: string): Promise<AdminUserDetail | null> {
    const user = await this.users.findById(userId);
    if (!user) {
      return null;
    }

    const dna = await this.dna.find(userId);
    const items = this.saves.listAll().filter((item) => item.userId === userId);
    const experiences = new Map(this.catalog.listAllExperiences().map((e) => [e.id, e]));
    const places = new Map(this.catalog.listAllPlaces().map((p) => [p.id, p]));

    const saves = items
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((item) => {
        const experience = experiences.get(item.experienceId);
        return {
          experienceId: item.experienceId,
          title: experience?.title ?? item.experienceId,
          placeName: experience ? (places.get(experience.placeId)?.name ?? null) : null,
          lat: experience?.coordinates.lat ?? 0,
          lng: experience?.coordinates.lng ?? 0,
          savedAt: item.savedAt,
        };
      });

    const recentSignals = (await this.signals.listForUser(userId, 60)).map((signal) => ({
      kind: signal.kind,
      experienceId: signal.experienceId || null,
      title: experiences.get(signal.experienceId)?.title ?? null,
      durationMs: signal.durationMs,
      occurredAt: signal.occurredAt,
    }));

    return { user: this.toUserRow(user, dna), dna, saves, recentSignals };
  }

  async listContent(query: AdminContentQuery): Promise<AdminContentPage> {
    let rows = this.catalog.listAllExperiences();

    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (experience) =>
          experience.title.toLowerCase().includes(needle) ||
          experience.slug.toLowerCase().includes(needle) ||
          experience.summary.toLowerCase().includes(needle),
      );
    }
    if (query.status) {
      rows = rows.filter((experience) => experience.status === query.status);
    }

    const total = rows.length;
    const page = rows.slice(query.offset, query.offset + query.limit);

    const savesByExperience = this.savesByExperience();
    const places = new Map(this.catalog.listAllPlaces().map((p) => [p.id, p]));
    const countries = new Map(this.catalog.listAllCountries().map((c) => [c.id, c]));

    return {
      total,
      rows: page.map((experience) => {
        const place = places.get(experience.placeId);
        return {
          experience,
          placeName: place?.name ?? null,
          countryCode: place ? (countries.get(place.countryId)?.code ?? null) : null,
          saveCount: savesByExperience.get(experience.id) ?? 0,
        };
      }),
    };
  }

  async listPlaces(): Promise<readonly AdminPlaceRow[]> {
    const countries = new Map(this.catalog.listAllCountries().map((c) => [c.id, c]));
    const regions = new Map(this.catalog.listAllRegions().map((r) => [r.id, r]));
    const experiences = this.catalog.listAllExperiences();

    return this.catalog
      .listAllPlaces()
      .map((place) => ({
        id: place.id,
        name: place.name,
        countryCode: countries.get(place.countryId)?.code ?? null,
        countryName: countries.get(place.countryId)?.name ?? null,
        regionName: place.regionId ? (regions.get(place.regionId)?.name ?? null) : null,
        lat: place.coordinates.lat,
        lng: place.coordinates.lng,
        experienceCount: experiences.filter((e) => e.placeId === place.id).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async activitySince(since: string, limit: number): Promise<readonly AdminActivityEvent[]> {
    const handles = new Map(this.users.listAll().map((user) => [user.id, user.handle]));
    const titles = new Map(this.catalog.listAllExperiences().map((e) => [e.id, e.title]));
    const events: AdminActivityEvent[] = [];

    for (const user of this.users.listAll()) {
      if (user.createdAt > since) {
        events.push({
          at: user.createdAt,
          kind: 'signup',
          userId: user.id,
          handle: user.handle,
          label: 'joined Firo',
          experienceId: null,
        });
      }
    }
    for (const item of this.saves.listAll()) {
      if (item.savedAt > since) {
        events.push({
          at: item.savedAt,
          kind: 'save',
          userId: item.userId,
          handle: handles.get(item.userId) ?? '?',
          label: `saved ${titles.get(item.experienceId) ?? item.experienceId}`,
          experienceId: item.experienceId,
        });
      }
    }
    for (const signal of this.signals.listAll()) {
      if (signal.occurredAt > since) {
        events.push({
          at: signal.occurredAt,
          kind: 'signal',
          userId: signal.userId,
          handle: handles.get(signal.userId) ?? '?',
          label: `${signal.kind} ${titles.get(signal.experienceId) ?? signal.experienceId}`.trim(),
          experienceId: signal.experienceId || null,
        });
      }
    }

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async mapPoints(): Promise<readonly AdminMapPoint[]> {
    const savesByExperience = this.savesByExperience();
    return this.catalog.listAllExperiences().map((experience: Experience) => ({
      experienceId: experience.id,
      title: experience.title,
      lat: experience.coordinates.lat,
      lng: experience.coordinates.lng,
      saves: savesByExperience.get(experience.id) ?? 0,
      status: experience.status,
      tags: experience.tags as readonly Tag[],
    }));
  }

  private savesByExperience(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of this.saves.listAll()) {
      counts.set(item.experienceId, (counts.get(item.experienceId) ?? 0) + 1);
    }
    return counts;
  }

  private toUserRow(user: User, knownDna?: ExplorerDna | null): AdminUserRow {
    const dna = knownDna !== undefined ? knownDna : this.dnaFor(user.id);
    const userSignals = this.signals.listAll().filter((signal) => signal.userId === user.id);
    const userSaves = this.saves.listAll().filter((item) => item.userId === user.id);
    // The later of the two things a user can do — see the Postgres adapter.
    const lastActiveAt = [
      ...userSignals.map((signal) => signal.occurredAt),
      ...userSaves.map((item) => item.savedAt),
    ].reduce<string | null>((latest, at) => (latest === null || at > latest ? at : latest), null);

    return {
      id: user.id,
      handle: user.handle,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      status: user.status as UserStatus,
      createdAt: user.createdAt,
      saveCount: userSaves.length,
      signalCount: userSignals.length,
      dnaCompleteness: profileCompleteness(dna),
      topTags: strongestTags(dna),
      lastActiveAt,
    };
  }

  private dnaFor(userId: string): ExplorerDna | null {
    return this.dna.listAll().find((profile) => profile.userId === userId) ?? null;
  }
}
