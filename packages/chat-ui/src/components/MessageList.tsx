import { useEffect, useLayoutEffect, useRef } from 'react';
import { useChatI18n } from '../i18n';
import type { UiMessage } from '../hooks/types';
import { MessageItem } from './MessageItem';

/** Distance (px) from an edge that counts as "at" that edge. */
const EDGE_THRESHOLD = 48;

export interface MessageListProps {
  messages: UiMessage[];
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  /** True while the initial history page is loading. */
  loadingHistory?: boolean;
  /** Older history exists above the window — scroll-up paging enabled. */
  hasMoreBefore?: boolean;
  /** Newer history exists below the window — scroll-down paging enabled. */
  hasMoreAfter?: boolean;
  /** Load one page of older messages (called near the top edge). */
  onLoadOlder?: () => void;
  /** Load one page of newer messages (called near the bottom edge). */
  onLoadNewer?: () => void;
}

/**
 * Scrollable, live-region message list with WhatsApp-style history paging:
 * scrolling near the top loads older messages (keeping the viewport anchored
 * on the previously-visible message), scrolling near the bottom loads newer
 * ones. Auto-scroll to new content only happens while the user is already at
 * the bottom, so reading old history is never yanked away.
 */
export function MessageList({
  messages,
  onApprove,
  onCancel,
  onFeedback,
  loadingHistory = false,
  hasMoreBefore = false,
  hasMoreAfter = false,
  onLoadOlder,
  onLoadNewer,
}: MessageListProps) {
  const { strings } = useChatI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Whether the user is pinned to the bottom (auto-scroll allowed).
  const nearBottomRef = useRef(true);
  // Prepend anchoring: remember the scroll height when an older page was
  // requested so the viewport can be offset by exactly the prepended height.
  const awaitingPrependRef = useRef(false);
  const prependScrollHeightRef = useRef(0);
  const prevFirstIdRef = useRef<string | undefined>(undefined);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distanceFromBottom <= EDGE_THRESHOLD;

    if (
      el.scrollTop <= EDGE_THRESHOLD &&
      hasMoreBefore &&
      onLoadOlder &&
      !awaitingPrependRef.current
    ) {
      awaitingPrependRef.current = true;
      prependScrollHeightRef.current = el.scrollHeight;
      onLoadOlder();
    }

    if (distanceFromBottom <= EDGE_THRESHOLD && hasMoreAfter && onLoadNewer) {
      onLoadNewer();
    }
  };

  // Keep the viewport anchored when an older page is prepended: offset the
  // scroll position by however much taller the list just became.
  useLayoutEffect(() => {
    const el = listRef.current;
    const firstId = messages[0]?.id;
    if (el && awaitingPrependRef.current && firstId !== prevFirstIdRef.current) {
      el.scrollTop += el.scrollHeight - prependScrollHeightRef.current;
      awaitingPrependRef.current = false;
    }
    prevFirstIdRef.current = firstId;
  }, [messages]);

  // Auto-scroll on new content (including streaming deltas) — but only while
  // the user is already at the bottom.
  const tail = messages[messages.length - 1];
  useEffect(() => {
    if (nearBottomRef.current) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, tail?.content]);

  return (
    <div
      ref={listRef}
      className="ffc-list"
      role="log"
      aria-live="polite"
      aria-busy={loadingHistory || tail?.streaming || undefined}
      onScroll={handleScroll}
    >
      {hasMoreBefore ? (
        <p className="ffc-history-more" aria-hidden="true">
          {strings.historyLoading}
        </p>
      ) : null}
      {loadingHistory ? (
        <p className="ffc-empty">{strings.historyLoading}</p>
      ) : messages.length === 0 ? (
        <p className="ffc-empty">{strings.emptyState}</p>
      ) : (
        messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            onApprove={onApprove}
            onCancel={onCancel}
            onFeedback={onFeedback}
          />
        ))
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
