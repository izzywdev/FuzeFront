"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatServiceClient = void 0;
const streaming_1 = require("./streaming");
class ChatServiceClient {
    constructor(config) {
        // Strip trailing slash for consistent URL construction
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.getToken = config.getToken;
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    authHeaders() {
        const token = this.getToken();
        if (token === null)
            return {};
        return { Authorization: `Bearer ${token}` };
    }
    async fetchJson(method, path, body) {
        const headers = {
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
        return res.json();
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
    async *streamChat(req) {
        let res;
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
        }
        catch (err) {
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
        yield* (0, streaming_1.parseSSEStream)(res.body);
    }
    /**
     * Confirm (approve) a pending tool call.
     * Throws on non-2xx (including 401).
     */
    async confirmTool(confirmationId) {
        await this.fetchJson('POST', `/chat/confirm/${confirmationId}`);
    }
    /**
     * List all conversations for the authenticated user / org.
     * Throws on non-2xx (including 401).
     */
    async listConversations() {
        return this.fetchJson('GET', '/chat/conversations');
    }
    /**
     * Fetch a single conversation with its full message history.
     * Throws on non-2xx (including 401).
     */
    async getConversation(id) {
        return this.fetchJson('GET', `/chat/conversations/${id}`);
    }
    /**
     * Submit thumbs-up / thumbs-down feedback for a message.
     * Throws on non-2xx (including 401).
     */
    async submitFeedback(messageId, rating) {
        await this.fetchJson('POST', '/chat/feedback', { messageId, rating });
    }
}
exports.ChatServiceClient = ChatServiceClient;
//# sourceMappingURL=client.js.map