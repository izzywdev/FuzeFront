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
  createdAt: string;
  updatedAt: string;
}

/** A single message stored in a conversation. */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
  createdAt: string;
}

/** Full conversation including stored message history. */
export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[];
}
