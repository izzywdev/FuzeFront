/**
 * useChat — drives a streaming conversation against a ChatServiceClient.
 *
 * Owns: the reduced message model, send/confirm/cancel/feedback actions, the
 * for-await consumption of the SSE event union, and the persisted-history
 * lifecycle — hydrating the most recent conversation for the caller's
 * (user, org, app) scope on mount, and paging older/newer messages with
 * cursors for bidirectional infinite scroll. The client's streamChat never
 * throws (it yields a terminal `error` event), so the loop here is plain.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  ChatMessage,
  ChatServiceClient,
  ConversationMessage,
} from '@fuzefront/chat-client';
import { chatReducer, initialModel, type ChatModel } from './chatReducer';
import type { UiMessage } from './types';

let idCounter = 0;
/** Monotonic id generator (crypto.randomUUID when available, else a counter). */
function nextId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Extract plain text from stored message content ({type:'text',text} or raw string). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in content) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return content == null ? '' : JSON.stringify(content);
}

/** Map a stored server message to the UI model (tool messages are not rendered). */
function toUiMessages(stored: ConversationMessage[]): UiMessage[] {
  return stored
    .filter((m): m is ConversationMessage & { role: 'user' | 'assistant' } => m.role !== 'tool')
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: contentText(m.content),
      streaming: false,
    }));
}

/** Map stored messages to the LLM request payload shape. */
function toChatMessages(stored: ConversationMessage[]): ChatMessage[] {
  return stored
    .filter((m): m is ConversationMessage & { role: 'user' | 'assistant' } => m.role !== 'tool')
    .map((m) => ({ role: m.role, content: contentText(m.content) }));
}

export interface UseChatOptions {
  client: ChatServiceClient;
  orgId: string;
  /** Consuming application ('fuzefront', 'mendys', ...) scoping the history. */
  appId?: string;
  conversationId?: string;
  /**
   * Load persisted history on mount. Without an explicit conversationId the
   * caller's most recent conversation for (user, org, app) is resumed —
   * WhatsApp-style. Default true.
   */
  resume?: boolean;
  /** History page size for hydrate/loadOlder/loadNewer. Default 50. */
  pageSize?: number;
  /** Called when a turn errors (in addition to the error surfacing in state). */
  onError?: (message: string) => void;
}

export interface UseChatResult extends ChatModel {
  send(text: string): Promise<void>;
  confirm(confirmationId: string): Promise<void>;
  cancel(confirmationId: string): void;
  feedback(messageId: string, rating: 'positive' | 'negative'): Promise<void>;
  /** Page one screen of older history above the loaded window (scroll up). */
  loadOlder(): Promise<void>;
  /** Page one screen of newer history below the loaded window (scroll down). */
  loadNewer(): Promise<void>;
  reset(): void;
}

export function useChat(options: UseChatOptions): UseChatResult {
  const { client, orgId, appId, conversationId, resume = true, pageSize = 50, onError } = options;
  const [model, dispatch] = useReducer(chatReducer, initialModel);

  // Keep the running history for the request payload without re-creating `send`.
  const historyRef = useRef<ChatMessage[]>([]);
  // The active thread; seeded by the prop / hydration, updated by the server's
  // `conversation` announcement so follow-up sends reuse the same thread.
  const conversationIdRef = useRef<string | undefined>(conversationId);
  // Cursor edges of the server-loaded window (server message ids).
  const oldestLoadedIdRef = useRef<string | undefined>(undefined);
  const newestLoadedIdRef = useRef<string | undefined>(undefined);
  // In-flight guards so scroll handlers can fire repeatedly without stacking requests.
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  // Keep the latest onError without retriggering the hydration effect.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Hydrate persisted history on mount / scope change. A scope change
  // (client/org/app/conversation) always starts from a clean slate — the
  // previous scope's messages must neither stay rendered nor leak into the
  // next streamChat payload via historyRef.
  useEffect(() => {
    conversationIdRef.current = conversationId;
    oldestLoadedIdRef.current = undefined;
    newestLoadedIdRef.current = undefined;
    historyRef.current = [];
    dispatch({ kind: 'reset' });
    if (!resume && !conversationId) return;

    let cancelled = false;
    (async () => {
      dispatch({ kind: 'hydrate_start' });
      try {
        let targetId = conversationId;
        if (!targetId) {
          // Most recent conversation for this (user, org, app) scope.
          const conversations = await client.listConversations({ appId, orgId });
          targetId = conversations[0]?.id;
        }
        if (!targetId) {
          if (!cancelled) {
            dispatch({ kind: 'hydrate_done', messages: [], hasMoreBefore: false, hasMoreAfter: false });
          }
          return;
        }
        const page = await client.getConversation(targetId, { limit: pageSize });
        if (cancelled) return;

        conversationIdRef.current = targetId;
        oldestLoadedIdRef.current = page.messages[0]?.id;
        newestLoadedIdRef.current = page.messages[page.messages.length - 1]?.id;
        historyRef.current = toChatMessages(page.messages);

        dispatch({
          kind: 'hydrate_done',
          conversationId: targetId,
          messages: toUiMessages(page.messages),
          hasMoreBefore: page.hasMoreBefore,
          hasMoreAfter: page.hasMoreAfter,
        });
      } catch (err) {
        if (cancelled) return;
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
        dispatch({ kind: 'hydrate_done', messages: [], hasMoreBefore: false, hasMoreAfter: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, orgId, appId, conversationId, resume, pageSize]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      dispatch({ kind: 'user_message', id: nextId('u'), content: trimmed });
      dispatch({ kind: 'assistant_start', id: nextId('a') });

      historyRef.current = [...historyRef.current, { role: 'user', content: trimmed }];

      let assistantText = '';
      for await (const event of client.streamChat({
        messages: historyRef.current,
        orgId,
        appId,
        conversationId: conversationIdRef.current,
      })) {
        if (event.type === 'conversation') conversationIdRef.current = event.conversationId;
        if (event.type === 'text_delta') assistantText += event.delta;
        if (event.type === 'error') onError?.(event.message);
        dispatch({ kind: 'stream_event', event });
        if (event.type === 'done' || event.type === 'error') break;
      }

      historyRef.current = [
        ...historyRef.current,
        { role: 'assistant', content: assistantText },
      ];
    },
    [client, orgId, appId, onError],
  );

  const loadOlder = useCallback(async () => {
    const targetId = conversationIdRef.current;
    const cursor = oldestLoadedIdRef.current;
    if (!targetId || !cursor || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    try {
      const page = await client.getConversation(targetId, { before: cursor, limit: pageSize });
      if (page.messages.length > 0) oldestLoadedIdRef.current = page.messages[0].id;
      dispatch({
        kind: 'history_prepend',
        messages: toUiMessages(page.messages),
        hasMoreBefore: page.hasMoreBefore,
      });
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    } finally {
      loadingOlderRef.current = false;
    }
  }, [client, pageSize]);

  const loadNewer = useCallback(async () => {
    const targetId = conversationIdRef.current;
    const cursor = newestLoadedIdRef.current;
    if (!targetId || !cursor || loadingNewerRef.current) return;
    loadingNewerRef.current = true;
    try {
      const page = await client.getConversation(targetId, { after: cursor, limit: pageSize });
      if (page.messages.length > 0) {
        newestLoadedIdRef.current = page.messages[page.messages.length - 1].id;
      }
      dispatch({
        kind: 'history_append',
        messages: toUiMessages(page.messages),
        hasMoreAfter: page.hasMoreAfter,
      });
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    } finally {
      loadingNewerRef.current = false;
    }
  }, [client, pageSize]);

  const confirm = useCallback(
    async (confirmationId: string) => {
      dispatch({ kind: 'confirm_running', confirmationId });
      try {
        await client.confirmTool(confirmationId);
        dispatch({ kind: 'confirm_resolved', confirmationId, status: 'approved' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onError?.(message);
        dispatch({ kind: 'confirm_resolved', confirmationId, status: 'denied', summary: message });
      }
    },
    [client, onError],
  );

  const cancel = useCallback((confirmationId: string) => {
    dispatch({ kind: 'confirm_resolved', confirmationId, status: 'denied' });
  }, []);

  const feedback = useCallback(
    async (messageId: string, rating: 'positive' | 'negative') => {
      dispatch({ kind: 'set_feedback', id: messageId, feedback: rating });
      try {
        await client.submitFeedback(messageId, rating);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [client, onError],
  );

  const reset = useCallback(() => {
    historyRef.current = [];
    conversationIdRef.current = undefined;
    oldestLoadedIdRef.current = undefined;
    newestLoadedIdRef.current = undefined;
    dispatch({ kind: 'reset' });
  }, []);

  return { ...model, send, confirm, cancel, feedback, loadOlder, loadNewer, reset };
}
