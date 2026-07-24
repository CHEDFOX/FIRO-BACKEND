import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and narrows a request payload against a zod schema, converting
 * failures into a standard 400 validation AppError with field-level details.
 * Usage: `@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput`.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const fields = error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        throw AppError.validation('request.invalid', 'Request validation failed', { fields });
      }
      throw error;
    }
  }
}
