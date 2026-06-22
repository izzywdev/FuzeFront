import { z } from 'zod';
export const notifyEmailStatusSchemaV1 = z.object({
    correlationId: z.string(),
    to: z.string().email(),
    template: z.string(),
    status: z.enum(['sent', 'failed', 'dead-lettered']),
    error: z.string().optional(),
    providerMessageId: z.string().optional(),
    attemptedAt: z.string(), // ISO-8601
});
