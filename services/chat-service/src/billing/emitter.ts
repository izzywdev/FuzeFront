// emitter.ts — emits billing.llm.usage events to Kafka after each LLM call
// (plan §6g). Billing is strictly non-blocking: any failure (Kafka down,
// schema validation) is logged and swallowed so it never breaks the user's
// streaming response.
//
// Uses the shared TypedProducer + billing.llm.usage schema so the wire format
// matches the future billing-consumer contract exactly.

import {
  TOPICS,
  billingLlmUsageSchemaV1,
  type BillingLlmUsagePayloadV1,
} from '@fuzefront/shared';

export interface LlmUsageInput {
  userId: string;
  orgId: string;
  conversationId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Narrow structural type so we can accept the shared TypedProducer or a mock.
export interface UsageProducer {
  send(
    topic: string,
    event: {
      version: string;
      topic: string;
      correlationId: string;
      occurredAt: string;
      payload: BillingLlmUsagePayloadV1;
    },
    schema: typeof billingLlmUsageSchemaV1,
  ): Promise<void>;
}

export class BillingEmitter {
  constructor(private readonly producer: UsageProducer) {}

  /** Emit a usage event. Never throws — logs and returns on any failure. */
  async emitUsage(input: LlmUsageInput): Promise<void> {
    try {
      const now = new Date().toISOString();
      const payload: BillingLlmUsagePayloadV1 = {
        userId: input.userId,
        orgId: input.orgId,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        conversationId: input.conversationId,
        timestamp: now,
      };

      await this.producer.send(
        TOPICS.BILLING_LLM_USAGE,
        {
          version: '1.0',
          topic: TOPICS.BILLING_LLM_USAGE,
          correlationId: input.conversationId,
          occurredAt: now,
          payload,
        },
        billingLlmUsageSchemaV1,
      );
    } catch (err) {
      // Non-blocking: billing failures must not crash the chat stream.
      // eslint-disable-next-line no-console
      console.warn('[chat-service] billing.llm.usage emit failed (ignored):', err);
    }
  }
}
