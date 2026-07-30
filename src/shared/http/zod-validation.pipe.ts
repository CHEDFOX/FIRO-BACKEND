import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and narrows a request payload against a zod schema, converting
 * failures into a standard 400 validation AppError with field-level details.
 * Usage: `@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput`.
 *
 * Generic over input and output separately so schemas using `.default()`,
 * `.coerce`, or `.transform()` (where the parsed type differs from the raw
 * type) type-check correctly.
 */
export class ZodValidationPipe<Output, Input = unknown> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output, ZodTypeDef, Input>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): Output {
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
