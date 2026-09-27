import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../../catalog/domain/catalog.repository';
import {
  type Experience,
  type PublicExperience,
  toPublicExperience,
} from '../../catalog/domain/experience';
import type { Tag } from '../../catalog/domain/taxonomy';
import { ListSavedUseCase } from '../../discovery/application/list-saved.usecase';
import {
  addDays,
  choosePick,
  cluesFor,
  dailyReason,
  greetingFor,
  localDay,
  localHour,
  monthInsight,
  timeOfDay,
  type TimeOfDay,
  tomorrowLine,
  worldSummary,
} from '../domain/daily';
import {
  DAILY_PICK_REPOSITORY,
  type DailyPickRepository,
  defaultRhythm,
  RHYTHM_REPOSITORY,
  type Rhythm,
  type RhythmMode,
  type RhythmRepository,
} from '../domain/daily.repository';
import { SignalKind } from '../domain/signal';
import { BuildFeedUseCase } from './build-feed.usecase';
import { GetDnaUseCase } from './get-dna.usecase';
import { RecordSignalUseCase } from './record-signal.usecase';

/** How far back the no-repeat rule looks. Two months of mornings. */
const NO_REPEAT_DAYS = 60;
/** How many ranked candidates the pick chooses from. */
const PICK_POOL = 30;

export interface PlaceView {
  readonly name: string;
  readonly region: string | null;
  readonly country: string | null;
  readonly countryCode: string | null;
  /** IANA zone of the place itself, so a client can say what time it is there. */
  readonly timeZone: string | null;
}

export interface TodayView {
  readonly day: string;
  readonly timeOfDay: TimeOfDay;
  /** The Arrive line: "Somewhere cold and quiet, today." */
  readonly greeting: string;
  /** Facts about the place revealed one by one before it is shown. */
  readonly clues: readonly string[];
  /** The day's last line, about tomorrow. */
  readonly tomorrow: string;
  readonly experience: PublicExperience;
  readonly place: PlaceView | null;
  readonly reason: string | null;
  readonly isWildcard: boolean;
  readonly kept: boolean;
  /** True on the very first day — the client skips Arrive after onboarding. */
  readonly isFirstDay: boolean;
}

async function placeOf(
  catalog: CatalogRepository,
  experience: Experience,
): Promise<PlaceView | null> {
  const place = await catalog.findPlaceById(experience.placeId);
  if (!place) {
    return null;
  }
  const [region, country] = await Promise.all([
    place.regionId ? catalog.findRegionById(place.regionId) : Promise.resolve(null),
    catalog.findCountryById(place.countryId),
  ]);
  return {
    name: place.name,
    region: region?.name ?? null,
    country: country?.name ?? null,
    countryCode: country?.code ?? null,
    timeZone: place.timezone,
  };
}

/**
 * Today's one place.
 *
 * Chosen on the first request of the user's local day and stored, so it holds
 * for the whole day: keeping it, or anything else, changes the profile and
 * therefore the ranking, but must not change what is on screen.
 */
@Injectable()
export class GetTodayUseCase {
  private readonly logger = new Logger(GetTodayUseCase.name);

  constructor(
    @Inject(DAILY_PICK_REPOSITORY) private readonly picks: DailyPickRepository,
    @Inject(RHYTHM_REPOSITORY) private readonly rhythms: RhythmRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    private readonly feed: BuildFeedUseCase,
    private readonly dna: GetDnaUseCase,
    private readonly saved: ListSavedUseCase,
    private readonly signals: RecordSignalUseCase,
  ) {}

  async execute(input: { userId: string; timeZone: string; now?: Date }): Promise<TodayView> {
    const now = input.now ?? new Date();
    const day = localDay(now, input.timeZone);

    let pick = await this.picks.find(input.userId, day);
    let experience = pick ? await this.catalog.findExperienceById(pick.experienceId) : null;

    // A stored pick whose experience has since been unpublished is replaced,
    // not shown: a card that 404s on tap is worse than a second choice.
    if (!pick || !experience || experience.status !== 'published') {
      const chosen = await this.choose(input.userId, day, now);
      pick = chosen.pick;
      experience = chosen.experience;
    }

    const [savedIds, recent, rhythm, placeRecord] = await Promise.all([
      this.saved.savedIds(input.userId),
      this.picks.recent(input.userId, 2),
      this.rhythms.find(input.userId),
      this.catalog.findPlaceById(experience.placeId),
    ]);

    return {
      day,
      timeOfDay: timeOfDay(localHour(now, input.timeZone)),
      greeting: greetingFor(experience.tags),
      clues: cluesFor({
        lat: experience.coordinates.lat,
        timeZone: placeRecord?.timezone ?? null,
        elevationMeters: placeRecord?.elevationMeters ?? null,
        seasonMask: experience.seasonMask,
        now,
      }),
      tomorrow: tomorrowLine(rhythm),
      experience: toPublicExperience(experience),
      place: await placeOf(this.catalog, experience),
      reason: pick.reason,
      isWildcard: pick.isWildcard,
      kept: savedIds.has(experience.id),
      isFirstDay: recent.length <= 1 && recent.every((entry) => entry.day === day),
    };
  }

  private async choose(userId: string, day: string, now: Date) {
    const [rhythm, recent, ranked, dna] = await Promise.all([
      this.rhythms.find(userId),
      this.picks.recent(userId, NO_REPEAT_DAYS),
      this.feed.execute({ userId, limit: PICK_POOL }),
      this.dna.load(userId),
    ]);

    // Today's own (replaced) pick must not count as "recent".
    const history = recent.filter((entry) => entry.day !== day);
    const chosen = choosePick(ranked, history, {
      surprise: rhythm?.surpriseNext ?? false,
      toward: rhythm?.surpriseToward ?? null,
    });
    if (!chosen) {
      throw AppError.notFound(
        'daily.nothing_to_show',
        'There is nothing in the catalogue to show yet. Publish an experience from the console.',
      );
    }

    const reason = dailyReason(chosen.item.experience.tags, dna, {
      isWildcard: chosen.isWildcard,
      asked: chosen.usedSurprise,
      toward: chosen.usedSurprise ? (rhythm?.surpriseToward ?? null) : null,
    });

    const stored = await this.picks.saveIfAbsent({
      userId,
      day,
      experienceId: chosen.item.experience.id,
      reason,
      isWildcard: chosen.isWildcard,
      chosenAt: now.toISOString(),
    });

    // The surprise was a one-shot for "tomorrow", and tomorrow is now.
    if (rhythm && chosen.usedSurprise && stored.experienceId === chosen.item.experience.id) {
      await this.rhythms.save({
        ...rhythm,
        surpriseNext: false,
        surpriseToward: null,
        updatedAt: now.toISOString(),
      });
    }

    // Exposure is how DNA tells "never saw it" apart from "saw it, passed".
    // Best-effort: a failed impression must never cost the user their morning.
    await this.signals
      .execute({ userId, kind: SignalKind.IMPRESSION, experienceId: stored.experienceId })
      .catch((error: unknown) =>
        this.logger.warn(
          `impression not recorded: ${error instanceof Error ? error.message : error}`,
        ),
      );

    const experience =
      stored.experienceId === chosen.item.experience.id
        ? chosen.item.experience
        : await this.catalog.findExperienceById(stored.experienceId);
    if (!experience) {
      throw AppError.notFound('daily.nothing_to_show', 'Today’s place is no longer available.');
    }
    return { pick: stored, experience };
  }
}

export interface DayCell {
  readonly day: string;
  readonly experienceId: string;
  readonly slug: string;
  readonly title: string;
  /** Colour sampled from the photograph, or null before one is uploaded. */
  readonly dominantColor: string | null;
  /** So a place without a photograph can still be drawn in its own mood. */
  readonly tags: readonly Tag[];
  readonly kept: boolean;
  readonly isWildcard: boolean;
}

export interface DaysView {
  readonly month: string;
  readonly today: string;
  readonly days: readonly DayCell[];
  readonly insight: string;
}

/** The quilt: every day this month the user opened Firo, in its own colour. */
@Injectable()
export class ListDaysUseCase {
  constructor(
    @Inject(DAILY_PICK_REPOSITORY) private readonly picks: DailyPickRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    private readonly saved: ListSavedUseCase,
  ) {}

  async execute(input: {
    userId: string;
    month?: string;
    timeZone: string;
    now?: Date;
  }): Promise<DaysView> {
    const today = localDay(input.now ?? new Date(), input.timeZone);
    const month = input.month ?? today.slice(0, 7);
    const first = `${month}-01`;
    const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);

    const [picks, savedIds] = await Promise.all([
      this.picks.listBetween(input.userId, first, last),
      this.saved.savedIds(input.userId),
    ]);
    const experiences = new Map(
      (await this.catalog.findExperiencesByIds(picks.map((pick) => pick.experienceId))).map(
        (experience) => [experience.id, experience],
      ),
    );

    const cells: DayCell[] = [];
    for (const pick of picks) {
      const experience = experiences.get(pick.experienceId);
      if (!experience) {
        continue;
      }
      cells.push({
        day: pick.day,
        experienceId: experience.id,
        slug: experience.slug,
        title: experience.title,
        dominantColor: experience.media[0]?.dominantColor ?? null,
        tags: experience.tags,
        kept: savedIds.has(experience.id),
        isWildcard: pick.isWildcard,
      });
    }

    const insight = monthInsight(
      cells.map((cell) => {
        const experience = experiences.get(cell.experienceId)!;
        return { tags: experience.tags, lat: experience.coordinates.lat, kept: cell.kept };
      }),
    );

    return { month, today, days: cells, insight };
  }
}

export interface WorldPlace {
  readonly experienceId: string;
  readonly slug: string;
  readonly title: string;
  readonly lat: number;
  readonly lng: number;
  readonly placeName: string | null;
  readonly countryCode: string | null;
  readonly dominantColor: string | null;
  readonly keptAt: string;
}

export interface WorldView {
  readonly places: readonly WorldPlace[];
  readonly headline: string;
  readonly detail: string;
  readonly question: string | null;
  readonly surpriseToward: Tag | null;
  /** Whether the user has already said yes for tomorrow. */
  readonly surpriseTomorrow: boolean;
}

/** Everything the user has kept, on their map, with a sentence about it. */
@Injectable()
export class GetWorldUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(RHYTHM_REPOSITORY) private readonly rhythms: RhythmRepository,
    private readonly saved: ListSavedUseCase,
  ) {}

  async execute(userId: string): Promise<WorldView> {
    const [saved, rhythm] = await Promise.all([
      this.saved.execute(userId),
      this.rhythms.find(userId),
    ]);

    const places: WorldPlace[] = [];
    const summaryInput = [];
    for (const entry of saved) {
      const experience = entry.experience;
      const place = await placeOf(this.catalog, experience);
      places.push({
        experienceId: experience.id,
        slug: experience.slug,
        title: experience.title,
        lat: experience.coordinates.lat,
        lng: experience.coordinates.lng,
        placeName: place?.name ?? null,
        countryCode: place?.countryCode ?? null,
        dominantColor: experience.media[0]?.dominantColor ?? null,
        keptAt: entry.savedAt,
      });
      summaryInput.push({
        tags: experience.tags,
        lat: experience.coordinates.lat,
        countryCode: place?.countryCode ?? null,
      });
    }

    const summary = worldSummary(summaryInput);
    return {
      places,
      ...summary,
      surpriseTomorrow: rhythm?.surpriseNext ?? false,
    };
  }
}

@Injectable()
export class RhythmUseCases {
  constructor(@Inject(RHYTHM_REPOSITORY) private readonly rhythms: RhythmRepository) {}

  async get(userId: string): Promise<Rhythm> {
    return (await this.rhythms.find(userId)) ?? defaultRhythm(userId, new Date().toISOString());
  }

  /**
   * When the daily note should arrive.
   *
   * Stored, not yet delivered: sending pushes needs APNs/FCM credentials that
   * this environment does not have. The preference is recorded now so the
   * choice the user makes in onboarding is honoured the day delivery exists.
   */
  async setRhythm(input: {
    userId: string;
    mode: RhythmMode;
    time: string | null;
    timeZone: string;
  }): Promise<Rhythm> {
    const current = await this.get(input.userId);
    const next: Rhythm = {
      ...current,
      mode: input.mode,
      notifyAt: input.mode === 'none' ? null : (input.time ?? defaultTime(input.mode)),
      timezone: input.timeZone,
      updatedAt: new Date().toISOString(),
    };
    await this.rhythms.save(next);
    return next;
  }

  /** "Shall tomorrow be somewhere warm?" — yes, no, or never mind. */
  async setTomorrow(input: {
    userId: string;
    surprise: boolean;
    toward: Tag | null;
  }): Promise<Rhythm> {
    const current = await this.get(input.userId);
    const next: Rhythm = {
      ...current,
      surpriseNext: input.surprise,
      surpriseToward: input.surprise ? input.toward : null,
      updatedAt: new Date().toISOString(),
    };
    await this.rhythms.save(next);
    return next;
  }
}

function defaultTime(mode: RhythmMode): string {
  return mode === 'evening' ? '21:00' : '07:30';
}
