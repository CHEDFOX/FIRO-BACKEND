import { Experience } from './experience';
import { Place } from './place';

/**
 * Port for catalog *writes*.
 *
 * Deliberately separate from CatalogRepository: reads are public, hot and
 * cacheable; writes come from the admin console, are rare, and are audited.
 * Keeping them apart means the read path can never accidentally be handed a
 * mutating dependency, and a future read replica needs no new abstraction.
 *
 * There is no `createCountry` — the geo hierarchy above a place is reference
 * data, changed by migration and seed, not by a web form.
 */
export interface CatalogWriter {
  /** Insert or replace an experience by id. */
  upsertExperience(experience: Experience): Promise<void>;
  /** Insert or replace a place by id. */
  upsertPlace(place: Place): Promise<void>;
  /**
   * Hard-deletes an experience. The console uses `status = 'archived'` for
   * everyday removal; this exists for genuinely bad rows and cascades to the
   * saves that reference it.
   */
  deleteExperience(id: string): Promise<boolean>;
}

export const CATALOG_WRITER = Symbol('CATALOG_WRITER');
