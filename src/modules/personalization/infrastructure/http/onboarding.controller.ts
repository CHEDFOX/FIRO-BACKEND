import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser, Public } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { GetDnaUseCase } from '../../application/get-dna.usecase';
import { SubmitOnboardingUseCase } from '../../application/submit-onboarding.usecase';
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
  ) {}

  @Get()
  @Public()
  flow() {
    return ONBOARDING_FLOW;
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
    return { ...result, profile };
  }
}
