/**
 * ChatServiceClient — typed HTTP/SSE client for the FuzeFront chat-service.
 *
 * Error handling contract
 * -----------------------
 * - `streamChat`: network/HTTP errors are yielded as a final `{type:'error', message}` event
 *   and then the generator returns.  Consumers using `for await` will see the error event
 *   naturally without needing to wrap the loop in try/catch.
 * - All other methods (`confirmTool`, `listConversations`, `getConversation`, `submitFeedback`)
 *   throw an `Error` on non-2xx responses (including 401).
 *
 * Auth
 * ----
 * Every request includes `Authorization: Bearer <token>` when `getToken()` returns a
 * non-null string.  When it returns `null` the header is omitted; a 401 from the server
 * is surfaced as a thrown error (or yielded error event for streamChat).
 */

import { parseSSEStream } from './streaming';
import type {
  ChatStreamRequest,
  ChatStreamEvent,
  Conversation,
  ConversationWithMessages,
} from './types';

export interface ChatServiceClientConfig {
  /** Base URL of the chat-service, e.g. `https://chat.example.com` */
  baseUrl: string;
  /** Returns the current bearer token, or `null` if not authenticated. */
  getToken: () => string | null;
}

export class ChatServiceClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;

  constructor(config: ChatServiceClientConfig) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.getToken = config.getToken;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    const token = this.getToken();
    if (token === null) return {};
    return { Authorization: `Bearer ${token}` };
  }

  private async fetchJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.authHeaders(),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open a streaming chat session.  Yields typed `ChatStreamEvent` objects as they arrive.
   *
   * On network or HTTP error, yields a final `{type:'error', message}` event instead of
   * throwing, so the caller's `for await` loop sees the error without needing try/catch.
   */
  async *streamChat(req: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.authHeaders(),
        },
        body: JSON.stringify(req),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
      return;
    }

    if (!res.ok) {
      yield { type: 'error', message: `HTTP ${res.status}: ${res.statusText}` };
      return;
    }

    if (!res.body) {
      yield { type: 'error', message: 'Response body is null' };
      return;
    }

    yield* parseSSEStream(res.body);
  }

  /**
   * Confirm (approve) a pending tool call.
   * Throws on non-2xx (including 401).
   */
  async confirmTool(confirmationId: string): Promise<void> {
    await this.fetchJson<unknown>('POST', `/chat/confirm/${confirmationId}`);
  }

  /**
   * List all conversations for the authenticated user / org.
   * Throws on non-2xx (including 401).
   */
  async listConversations(): Promise<Conversation[]> {
    return this.fetchJson<Conversation[]>('GET', '/chat/conversations');
  }

  /**
   * Fetch a single conversation with its full message history.
   * Throws on non-2xx (including 401).
   */
  async getConversation(id: string): Promise<ConversationWithMessages> {
    return this.fetchJson<ConversationWithMessages>('GET', `/chat/conversations/${id}`);
  }

  /**
   * Submit thumbs-up / thumbs-down feedback for a message.
   * Throws on non-2xx (including 401).
   */
  async submitFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void> {
    await this.fetchJson<unknown>('POST', '/chat/feedback', { messageId, rating });
  }
}
