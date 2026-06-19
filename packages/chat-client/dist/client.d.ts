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
import type { ChatStreamRequest, ChatStreamEvent, Conversation, ConversationWithMessages } from './types';
export interface ChatServiceClientConfig {
    /** Base URL of the chat-service, e.g. `https://chat.example.com` */
    baseUrl: string;
    /** Returns the current bearer token, or `null` if not authenticated. */
    getToken: () => string | null;
}
export declare class ChatServiceClient {
    private readonly baseUrl;
    private readonly getToken;
    constructor(config: ChatServiceClientConfig);
    private authHeaders;
    private fetchJson;
    /**
     * Open a streaming chat session.  Yields typed `ChatStreamEvent` objects as they arrive.
     *
     * On network or HTTP error, yields a final `{type:'error', message}` event instead of
     * throwing, so the caller's `for await` loop sees the error without needing try/catch.
     */
    streamChat(req: ChatStreamRequest): AsyncIterable<ChatStreamEvent>;
    /**
     * Confirm (approve) a pending tool call.
     * Throws on non-2xx (including 401).
     */
    confirmTool(confirmationId: string): Promise<void>;
    /**
     * List all conversations for the authenticated user / org.
     * Throws on non-2xx (including 401).
     */
    listConversations(): Promise<Conversation[]>;
    /**
     * Fetch a single conversation with its full message history.
     * Throws on non-2xx (including 401).
     */
    getConversation(id: string): Promise<ConversationWithMessages>;
    /**
     * Submit thumbs-up / thumbs-down feedback for a message.
     * Throws on non-2xx (including 401).
     */
    submitFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map