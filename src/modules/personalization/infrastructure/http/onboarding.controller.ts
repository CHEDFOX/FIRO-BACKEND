import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../../shared/errors/app-error';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../../../catalog/domain/catalog.repository';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser, Public } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { GetDnaUseCase } from '../../application/get-dna.usecase';
import { SubmitOnboardingUseCase } from '../../application/submit-onboarding.usecase';
import { sketchOf } from '../../domain/daily';
import { ONBOARDING_FLOW } from '../../domain/onboarding';

export const SubmitOnboardingSchema = z.object({
  answers: z
    .array(
      z.object({
        stepId: z.string().min(1).max(64),
        selectedOptionIds: z.array(z.string().min(1).max(64)).max(20),
      }),
    )
    .min(1)
    .max(20),
});
export type SubmitOnboardingInput = z.infer<typeof SubmitOnboardingSchema>;

/**
 * Onboarding: the taste picker that gives a new profile its first shape.
 *
 * The flow itself is public so the client can render it before sign-up if
 * product ever wants to; submitting requires an account, because the answers
 * are folded into that user's Explorer DNA.
 */
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly submitOnboarding: SubmitOnboardingUseCase,
    private readonly getDna: GetDnaUseCase,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  /**
   * The flow, with each option's photograph resolved from the catalogue.
   *
   * An option whose experience has no photograph yet (or none at all) comes
   * back with `image: null`, and the client paints its colour instead — so the
   * flow is complete from day one and gets more beautiful as the catalogue
   * does, with no release in between.
   */
  @Get()
  @Public()
  async flow() {
    const ids = ONBOARDING_FLOW.steps.flatMap((step) =>
      step.options.flatMap((option) => (option.imageFrom ? [option.imageFrom] : [])),
    );
    const experiences = new Map(
      (await this.catalog.findExperiencesByIds([...new Set(ids)])).map((experience) => [
        experience.id,
        experience,
      ]),
    );

    return {
      ...ONBOARDING_FLOW,
      steps: ONBOARDING_FLOW.steps.map((step) => ({
        ...step,
        options: step.options.map((option) => {
          const media = option.imageFrom
            ? (experiences.get(option.imageFrom)?.media[0] ?? null)
            : null;
          return {
            id: option.id,
            label: option.label,
            tags: option.tags,
            dominantColor: media?.dominantColor ?? option.dominantColor,
            image: media
              ? { url: media.url, variants: media.variants ?? [], alt: media.alt ?? null }
              : null,
          };
        }),
      })),
    };
  }

  @Post('answers')
  @HttpCode(200)
  async submit(
    @Body(new ZodValidationPipe(SubmitOnboardingSchema)) body: SubmitOnboardingInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    if (!principal) {
      throw AppError.unauthenticated();
    }
    const result = await this.submitOnboarding.execute({
      userId: principal.userId,
      answers: body.answers,
    });

    // Return the freshly seeded profile so the client can show the user what
    // Firo just learned about them — the payoff that makes onboarding feel
    // worth completing.
    const profile = await this.getDna.execute(principal.userId);
    return {
      ...result,
      profile,
      // The first sketch, in words, for the screen right after onboarding.
      sketch: sketchOf(profile.topTastes.map((taste) => taste.tag)),
    };
  }
}
