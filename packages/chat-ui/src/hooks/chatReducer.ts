/**
 * Pure reducer that folds a ChatStreamEvent union into the UI message list.
 * Kept side-effect-free so it can be unit-tested without React.
 *
 * Event handling (matches @fuzefront/chat-client's ChatStreamEvent):
 *   conversation -> record the server-resolved conversation id (thread resume)
 *   text_delta   -> append delta to the current streaming assistant message
 *   rag_sources  -> attach citations to the current assistant message
 *   tool_pending -> add a pending confirmation card to the current message
 *   tool_result  -> resolve the matching confirmation (approved + summary)
 *   tool_denied  -> mark the relevant confirmation denied
 *   error        -> set error on the current assistant message
 *   done         -> mark the current assistant message no longer streaming
 *
 * History actions (hydrate / infinite scroll) merge server-loaded pages into
 * the same message list: hydrate_done seeds the newest page, history_prepend
 * adds an older page above (scroll up), history_append a newer page below.
 */
import type { ChatStreamEvent } from '@fuzefront/chat-client';
import type { PendingConfirmation, UiMessage } from './types';

export interface ChatModel {
  messages: UiMessage[];
  /** True while a turn is streaming. */
  streaming: boolean;
  /** True while the initial history page is loading (composer disabled). */
  loadingHistory: boolean;
  /** Older messages exist above the loaded window (enables scroll-up paging). */
  hasMoreBefore: boolean;
  /** Newer messages exist below the loaded window (enables scroll-down paging). */
  hasMoreAfter: boolean;
  /** The active server conversation id, once known (prop, hydrate, or stream). */
  conversationId?: string;
  /**
   * Monotonic count of locally-sent user messages. UI uses it to force-scroll
   * to the bottom on the user's OWN send even when they had scrolled up into
   * history (streamed deltas alone never yank a reader away from history).
   */
  sendCount: number;
}

export type ChatAction =
  | { kind: 'user_message'; id: string; content: string }
  | { kind: 'assistant_start'; id: string }
  | { kind: 'stream_event'; event: ChatStreamEvent }
  | { kind: 'set_feedback'; id: string; feedback: 'positive' | 'negative' }
  | { kind: 'confirm_running'; confirmationId: string }
  | { kind: 'confirm_resolved'; confirmationId: string; status: 'approved' | 'denied'; summary?: string }
  | { kind: 'hydrate_start' }
  | {
      kind: 'hydrate_done';
      messages: UiMessage[];
      conversationId?: string;
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    }
  | { kind: 'history_prepend'; messages: UiMessage[]; hasMoreBefore: boolean }
  | { kind: 'history_append'; messages: UiMessage[]; hasMoreAfter: boolean }
  | { kind: 'reset' };

export const initialModel: ChatModel = {
  messages: [],
  streaming: false,
  loadingHistory: false,
  hasMoreBefore: false,
  hasMoreAfter: false,
  conversationId: undefined,
  sendCount: 0,
};

/** Update the last assistant message in place via the given transform. */
function mapLastAssistant(
  messages: UiMessage[],
  fn: (m: UiMessage) => UiMessage,
): UiMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      const next = messages.slice();
      next[i] = fn(messages[i]);
      return next;
    }
  }
  return messages;
}

function updateConfirmation(
  confirmations: PendingConfirmation[] | undefined,
  confirmationId: string,
  patch: Partial<PendingConfirmation>,
): PendingConfirmation[] | undefined {
  if (!confirmations) return confirmations;
  return confirmations.map((c) => (c.confirmationId === confirmationId ? { ...c, ...patch } : c));
}

export function chatReducer(state: ChatModel, action: ChatAction): ChatModel {
  switch (action.kind) {
    case 'reset':
      return initialModel;

    case 'user_message':
      return {
        ...state,
        sendCount: state.sendCount + 1,
        messages: [
          ...state.messages,
          { id: action.id, role: 'user', content: action.content, streaming: false },
        ],
      };

    case 'assistant_start':
      return {
        ...state,
        streaming: true,
        messages: [
          ...state.messages,
          { id: action.id, role: 'assistant', content: '', streaming: true },
        ],
      };

    case 'set_feedback':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, feedback: action.feedback } : m,
        ),
      };

    case 'confirm_running':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          confirmations: updateConfirmation(m.confirmations, action.confirmationId, {
            status: 'running',
          }),
        })),
      };

    case 'confirm_resolved':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          confirmations: updateConfirmation(m.confirmations, action.confirmationId, {
            status: action.status,
            summary: action.summary,
          }),
        })),
      };

    case 'hydrate_start':
      return { ...state, loadingHistory: true };

    case 'hydrate_done':
      return {
        ...state,
        loadingHistory: false,
        conversationId: action.conversationId ?? state.conversationId,
        hasMoreBefore: action.hasMoreBefore,
        hasMoreAfter: action.hasMoreAfter,
        // Anything already streamed locally stays below the hydrated history.
        messages: [...action.messages, ...state.messages],
      };

    case 'history_prepend':
      return {
        ...state,
        hasMoreBefore: action.hasMoreBefore,
        messages: [...action.messages, ...state.messages],
      };

    case 'history_append':
      return {
        ...state,
        hasMoreAfter: action.hasMoreAfter,
        messages: [...state.messages, ...action.messages],
      };

    case 'stream_event':
      return applyStreamEvent(state, action.event);

    default:
      return state;
  }
}

function applyStreamEvent(state: ChatModel, event: ChatStreamEvent): ChatModel {
  switch (event.type) {
    case 'conversation':
      return { ...state, conversationId: event.conversationId };

    case 'text_delta':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          content: m.content + event.delta,
        })),
      };

    case 'rag_sources':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({ ...m, sources: event.sources })),
      };

    case 'tool_pending': {
      const pending: PendingConfirmation = {
        confirmationId: event.confirmationId,
        toolName: event.toolName,
        args: event.args,
        description: event.description,
        status: 'pending',
      };
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          confirmations: [...(m.confirmations ?? []), pending],
        })),
      };
    }

    case 'tool_result':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          confirmations: updateConfirmation(m.confirmations, event.confirmationId, {
            status: event.success ? 'approved' : 'denied',
            summary: event.summary,
          }),
        })),
      };

    case 'tool_denied':
      return {
        ...state,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          // tool_denied carries no confirmationId; surface the reason as a summary
          // on any still-pending confirmation for the named tool.
          confirmations: (m.confirmations ?? []).map((c) =>
            c.toolName === event.toolName && c.status === 'pending'
              ? { ...c, status: 'denied', summary: event.reason }
              : c,
          ),
        })),
      };

    case 'error':
      return {
        ...state,
        streaming: false,
        messages: mapLastAssistant(state.messages, (m) => ({
          ...m,
          streaming: false,
          error: event.message,
        })),
      };

    case 'done':
      return {
        ...state,
        streaming: false,
        messages: mapLastAssistant(state.messages, (m) => ({ ...m, streaming: false })),
      };

    default:
      return state;
  }
}
