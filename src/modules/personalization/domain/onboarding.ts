import { Tag } from '../../catalog/domain/taxonomy';

/**
 * The onboarding taste picker — how a brand-new profile gets its first shape.
 *
 * Two deliberate choices:
 *  - IMAGES, NOT QUESTIONS. "Pick the one that pulls you" is far more
 *    informative than "do you like adventure?", and it feels like a game
 *    rather than a form.
 *  - FORCED CHOICES. An either/or between contrasting options tells us more
 *    per tap than any single rating, because it separates two dimensions at
 *    once: what was chosen gains evidence, what was passed over loses a little.
 *
 * The flow is data, not code, so product can reshape onboarding without a
 * release — the same principle the BDUI engine applies to whole screens.
 */

export const OnboardingStepType = {
  /** Choose one of two contrasting options. */
  EITHER_OR: 'either_or',
  /** Choose any number that appeal. */
  MULTI_SELECT: 'multi_select',
} as const;

export type OnboardingStepType = (typeof OnboardingStepType)[keyof typeof OnboardingStepType];

export interface OnboardingOption {
  readonly id: string;
  readonly label: string;
  /** The taste dimensions this option is evidence for. */
  readonly tags: Tag[];
  /** Illustrative image; the client may show a colour block until it loads. */
  readonly imageUrl: string | null;
  readonly dominantColor: string;
}

export interface OnboardingStep {
  readonly id: string;
  readonly type: OnboardingStepType;
  readonly title: string;
  readonly subtitle: string | null;
  readonly minSelect: number;
  readonly options: OnboardingOption[];
}

export interface OnboardingFlow {
  readonly version: string;
  readonly steps: OnboardingStep[];
}

function option(id: string, label: string, tags: Tag[], dominantColor: string): OnboardingOption {
  return {
    id,
    label,
    tags,
    imageUrl: `https://media.firo.app/onboarding/${id}.jpg`,
    dominantColor,
  };
}

/**
 * The seeded flow. Options are spread so each step separates genuinely
 * different tastes rather than offering near-duplicates — a choice between two
 * similar things teaches us almost nothing.
 */
export const ONBOARDING_FLOW: OnboardingFlow = {
  version: '1',
  steps: [
    {
      id: 'pull',
      type: OnboardingStepType.MULTI_SELECT,
      title: 'What pulls you toward a place?',
      subtitle: 'Pick a few. Firo learns the rest.',
      minSelect: 1,
      options: [
        option('cold_quiet', 'Cold & quiet', [Tag.COLD, Tag.SOLITUDE], '#1B2A3A'),
        option('warm_water', 'Warm water', [Tag.WARM, Tag.WATER, Tag.BEACH], '#D2A15E'),
        option('high_places', 'High places', [Tag.MOUNTAINS, Tag.HIKING], '#4A4E55'),
        option(
          'old_streets',
          'Old streets',
          [Tag.CULTURE, Tag.HISTORY, Tag.ARCHITECTURE],
          '#3B2418',
        ),
        option('empty_land', 'Empty land', [Tag.DESERT, Tag.MINIMALISM, Tag.SOLITUDE], '#C08A4E'),
        option('good_food', 'Good food', [Tag.FOOD, Tag.CITY], '#7A3B2E'),
      ],
    },
    {
      id: 'pace',
      type: OnboardingStepType.EITHER_OR,
      title: 'Which evening sounds better?',
      subtitle: null,
      minSelect: 1,
      options: [
        option(
          'quiet_night',
          'Nobody around, just the view',
          [Tag.SOLITUDE, Tag.NATURE],
          '#12181F',
        ),
        option(
          'busy_night',
          'A loud table full of strangers',
          [Tag.SOCIAL, Tag.NIGHTLIFE],
          '#5B2A45',
        ),
      ],
    },
    {
      id: 'effort',
      type: OnboardingStepType.EITHER_OR,
      title: 'How do you want to arrive?',
      subtitle: null,
      minSelect: 1,
      options: [
        option(
          'earn_it',
          'Four hours uphill to get there',
          [Tag.HIKING, Tag.ADVENTURE, Tag.CAMPING],
          '#3F5540',
        ),
        option('easy_it', 'Somewhere comfortable, already set up', [Tag.LUXURY], '#6B5B73'),
      ],
    },
    {
      id: 'looking',
      type: OnboardingStepType.MULTI_SELECT,
      title: 'And what are you hoping to bring home?',
      subtitle: null,
      minSelect: 1,
      options: [
        option('photos', 'Photographs', [Tag.PHOTOGRAPHY], '#24384B'),
        option('stories', 'Stories', [Tag.ADVENTURE, Tag.ROAD_TRIP], '#5B6E7A'),
        option('quiet_head', 'A quieter head', [Tag.SOLITUDE, Tag.MINIMALISM], '#2C3B2A'),
        option('wild_sight', 'Something wild', [Tag.WILDLIFE, Tag.NATURE], '#3F5540'),
      ],
    },
  ],
};

export function findStep(stepId: string): OnboardingStep | null {
  return ONBOARDING_FLOW.steps.find((step) => step.id === stepId) ?? null;
}

export function findOption(step: OnboardingStep, optionId: string): OnboardingOption | null {
  return step.options.find((candidate) => candidate.id === optionId) ?? null;
}
