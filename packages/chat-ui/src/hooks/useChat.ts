/**
 * useChat — drives a streaming conversation against a ChatServiceClient.
 *
 * Owns: the reduced message model, send/confirm/cancel/feedback actions, and the
 * for-await consumption of the SSE event union. The client's streamChat never
 * throws (it yields a terminal `error` event), so the loop here is plain.
 */
import { useCallback, useReducer, useRef } from 'react';
import type { ChatMessage, ChatServiceClient } from '@fuzefront/chat-client';
import { chatReducer, initialModel, type ChatModel } from './chatReducer';

let idCounter = 0;
/** Monotonic id generator (crypto.randomUUID when available, else a counter). */
function nextId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface UseChatOptions {
  client: ChatServiceClient;
  orgId: string;
  conversationId?: string;
  /** Called when a turn errors (in addition to the error surfacing in state). */
  onError?: (message: string) => void;
}

export interface UseChatResult extends ChatModel {
  send(text: string): Promise<void>;
  confirm(confirmationId: string): Promise<void>;
  cancel(confirmationId: string): void;
  feedback(messageId: string, rating: 'positive' | 'negative'): Promise<void>;
  reset(): void;
}

export function useChat(options: UseChatOptions): UseChatResult {
  const { client, orgId, conversationId, onError } = options;
  const [model, dispatch] = useReducer(chatReducer, initialModel);

  // Keep the running history for the request payload without re-creating `send`.
  const historyRef = useRef<ChatMessage[]>([]);

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
        conversationId,
      })) {
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
    [client, orgId, conversationId, onError],
  );

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
    dispatch({ kind: 'reset' });
  }, []);

  return { ...model, send, confirm, cancel, feedback, reset };
}
