import { z } from 'zod';

const handle = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/, 'Handle may contain letters, numbers, "_" and "."');

const password = z.string().min(8).max(200);
const email = z.string().trim().email().max(320);
const deviceId = z.string().trim().min(1).max(200).optional();

export const RegisterSchema = z.object({
  email,
  password,
  handle,
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.string().trim().min(2).max(35).optional(),
  deviceId,
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email,
  password,
  deviceId,
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
  deviceId,
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const LogoutSchema = z.object({
  refreshToken: z.string().min(10),
});
export type LogoutInput = z.infer<typeof LogoutSchema>;
