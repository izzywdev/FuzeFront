import type {
  ChatServiceClient,
  ChatStreamEvent,
  ChatStreamRequest,
} from '@fuzefront/chat-client';

/**
 * A minimal stand-in for ChatServiceClient that replays a scripted event list
 * for streamChat and records confirm/feedback calls. Implements only the methods
 * the UI uses, cast to the client type for the hook's signature.
 */
export interface FakeClient {
  client: ChatServiceClient;
  confirmCalls: string[];
  feedbackCalls: Array<{ messageId: string; rating: 'positive' | 'negative' }>;
}

export function makeFakeClient(
  events: ChatStreamEvent[],
  opts: { confirmThrows?: boolean; feedbackThrows?: boolean } = {},
): FakeClient {
  const confirmCalls: string[] = [];
  const feedbackCalls: Array<{ messageId: string; rating: 'positive' | 'negative' }> = [];

  const client = {
    async *streamChat(_req: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      for (const ev of events) {
        // microtask boundary so React can flush between deltas
        await Promise.resolve();
        yield ev;
      }
    },
    async confirmTool(confirmationId: string): Promise<void> {
      confirmCalls.push(confirmationId);
      if (opts.confirmThrows) throw new Error('PDP denied');
    },
    async submitFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void> {
      feedbackCalls.push({ messageId, rating });
      if (opts.feedbackThrows) throw new Error('feedback failed');
    },
    async listConversations() {
      return [];
    },
    async getConversation(id: string) {
      return { id, title: null, createdAt: '', updatedAt: '', messages: [] };
    },
  } as unknown as ChatServiceClient;

  return { client, confirmCalls, feedbackCalls };
}
