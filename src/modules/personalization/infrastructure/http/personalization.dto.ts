import { z } from 'zod';
import { ALL_SIGNAL_KINDS } from '../../domain/signal';

export const RecordSignalSchema = z.object({
  kind: z.enum(ALL_SIGNAL_KINDS as unknown as [string, ...string[]]),
  experienceId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100).optional(),
  /** Only meaningful for a dwell signal. */
  durationMs: z.coerce.number().int().min(0).max(600_000).optional(),
});
export type RecordSignalInput = z.infer<typeof RecordSignalSchema>;

export const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sessionId: z.string().min(1).max(100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type FeedQueryInput = z.infer<typeof FeedQuerySchema>;
