import type {
  ChatServiceClient,
  ChatStreamEvent,
  ChatStreamRequest,
  Conversation,
  ConversationWithMessages,
  GetConversationOptions,
  ListConversationsFilter,
} from '@fuzefront/chat-client';

/**
 * A minimal stand-in for ChatServiceClient that replays a scripted event list
 * for streamChat, records confirm/feedback calls, and serves scripted
 * conversation history for the hydrate/infinite-scroll paths. Implements only
 * the methods the UI uses, cast to the client type for the hook's signature.
 */
export interface FakeClient {
  client: ChatServiceClient;
  confirmCalls: string[];
  feedbackCalls: Array<{ messageId: string; rating: 'positive' | 'negative' }>;
  listCalls: ListConversationsFilter[];
  getCalls: Array<{ id: string; options?: GetConversationOptions }>;
  streamRequests: ChatStreamRequest[];
}

export interface FakeClientOptions {
  confirmThrows?: boolean;
  feedbackThrows?: boolean;
  /** Scripted result for listConversations (default []). */
  conversations?: Conversation[];
  /** Scripted results for getConversation, consumed in call order. */
  pages?: ConversationWithMessages[];
}

export function makeFakeClient(
  events: ChatStreamEvent[],
  opts: FakeClientOptions = {},
): FakeClient {
  const confirmCalls: string[] = [];
  const feedbackCalls: Array<{ messageId: string; rating: 'positive' | 'negative' }> = [];
  const listCalls: ListConversationsFilter[] = [];
  const getCalls: Array<{ id: string; options?: GetConversationOptions }> = [];
  const streamRequests: ChatStreamRequest[] = [];
  const pages = [...(opts.pages ?? [])];

  const client = {
    async *streamChat(req: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
      streamRequests.push(req);
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
    async listConversations(filter: ListConversationsFilter = {}) {
      listCalls.push(filter);
      return opts.conversations ?? [];
    },
    async getConversation(id: string, options?: GetConversationOptions) {
      getCalls.push({ id, options });
      const page = pages.shift();
      if (page) return page;
      return {
        id,
        title: null,
        appId: 'fuzefront',
        orgId: null,
        createdAt: '',
        updatedAt: '',
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      };
    },
  } as unknown as ChatServiceClient;

  return { client, confirmCalls, feedbackCalls, listCalls, getCalls, streamRequests };
}
