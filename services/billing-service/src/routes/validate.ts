import { ZodSchema } from 'zod';

/**
 * Validation result with a NON-union shape so callers can read `.data` /
 * `.details` after a plain `if (!result.ok)` check without relying on
 * discriminated-union narrowing — which does not fire under this service's
 * `strict: false` tsconfig (same constraint that forces the cast workaround in
 * sms-service routes).
 */
export interface ValidationResult<T> {
  ok: boolean;
  /** Present (and correct) when ok === true. */
  data: T;
  /** Present when ok === false. */
  details: unknown;
}

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return { ok: true, data: (parsed as { success: true; data: T }).data, details: undefined };
  }
  const failure = parsed as { success: false; error: { flatten: () => unknown } };
  return { ok: false, data: undefined as unknown as T, details: failure.error.flatten() };
}
