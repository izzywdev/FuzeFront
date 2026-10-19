/**
 * UI-facing chat state model. Derived entirely from the @fuzefront/chat-client
 * SSE event union — this module owns the reduction of stream events into the
 * render model the components consume.
 */
import type { RagSource } from '@fuzefront/chat-client';

export type { RagSource };

/** A pending mutating tool awaiting the user's confirmation (tool_pending). */
export interface PendingConfirmation {
  confirmationId: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  /** Set once the user has approved and the confirm request is in flight. */
  status: 'pending' | 'running' | 'approved' | 'denied';
  /** Outcome summary once resolved (from tool_result / tool_denied). */
  summary?: string;
}

export interface CustomToolCard {
  id: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  createdAt?: string;
}

export interface ThoughtStep {
  id: string;
  title: string;
  durationMs?: number;
  content: string;
  expanded?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  lastMessageSnippet?: string;
  updatedAt: string;
  model?: string;
  unreadCount?: number;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Streamed/accumulated text content. */
  content: string;
  /** True while this assistant message is still receiving text_delta events. */
  streaming: boolean;
  /** RAG citations attached to this assistant message, if any. */
  sources?: RagSource[];
  /** Mutating-tool confirmations raised during this assistant turn. */
  confirmations?: PendingConfirmation[];
  /** Local feedback selection (optimistic). */
  feedback?: 'positive' | 'negative';
  /** Error message if the turn failed. */
  error?: string;
  /** ISO-8601 timestamp the message was created (server-persisted or locally stamped on send). */
  createdAt?: string;
  /** Custom interactive tool cards rendered inline or stacked with the turn. */
  cards?: CustomToolCard[];
  /** Collapsible thought process / chain-of-thought steps. */
  thoughts?: ThoughtStep[];
}
