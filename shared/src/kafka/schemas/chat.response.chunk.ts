import { z } from 'zod';

export const chatResponseChunkSchemaV1 = z.object({
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: z.enum(['start', 'delta', 'done', 'error']),
  delta: z.string().optional(),
});

export type ChatResponseChunkPayloadV1 = z.infer<typeof chatResponseChunkSchemaV1>;
