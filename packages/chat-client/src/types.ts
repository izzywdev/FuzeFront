/**
 * Shared request/response and event union types for the FuzeFront chat-service client.
 */

/** A single message in a chat exchange. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Request payload for the streaming chat endpoint. */
export interface ChatStreamRequest {
  messages: ChatMessage[];
  conversationId?: string;
  orgId: string;
  /**
   * Consuming application ('fuzefront', 'mendys', ...). Scopes the
   * conversation to (userId, appId[, orgId]). Ignored when the JWT already
   * carries an appId claim; the server defaults to 'fuzefront'.
   */
  appId?: string;
}

/** A source document returned by the RAG pipeline. */
export interface RagSource {
  title: string;
  url: string;
  excerpt: string;
}

/**
 * Union of all SSE events emitted by the chat-service stream endpoint.
 * Each variant carries a discriminant `type` field.
 */
export type ChatStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_pending';
      confirmationId: string;
      toolName: string;
      args: Record<string, unknown>;
      description: string;
    }
  | { type: 'tool_result'; confirmationId: string; success: boolean; summary: string }
  | { type: 'tool_denied'; toolName: string; reason: string }
  | { type: 'rag_sources'; sources: RagSource[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Conversation metadata (without messages). */
export interface Conversation {
  id: string;
  title: string | null;
  /** Consuming application the conversation belongs to. */
  appId: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Optional tenant filters for listConversations. */
export interface ListConversationsFilter {
  appId?: string;
  orgId?: string;
}

/** Cursor options for getConversation's message page. */
export interface GetConversationOptions {
  /** Page towards messages older than this message id (scroll up). */
  before?: string;
  /** Page towards messages newer than this message id (scroll down). */
  after?: string;
  /** Page size (server default 50, max 200). */
  limit?: number;
}

/** A single message stored in a conversation. */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
  createdAt: string;
}

/**
 * A conversation plus one keyset-paginated page of its history.
 * `messages` is oldest-first; without a cursor it is the NEWEST page.
 */
export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[];
  /** Older messages exist before the first message of this page. */
  hasMoreBefore: boolean;
  /** Newer messages exist after the last message of this page. */
  hasMoreAfter: boolean;
}
