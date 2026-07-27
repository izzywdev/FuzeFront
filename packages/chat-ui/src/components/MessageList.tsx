import { useEffect, useRef } from 'react';
import { useChatI18n } from '../i18n';
import type { UiMessage } from '../hooks/types';
import { MessageItem } from './MessageItem';

export interface MessageListProps {
  messages: UiMessage[];
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
}

/** Scrollable, auto-scrolling, live-region message list. */
export function MessageList({ messages, onApprove, onCancel, onFeedback }: MessageListProps) {
  const { strings } = useChatI18n();
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content (including streaming deltas).
  const tail = messages[messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, tail?.content]);

  return (
    <div className="ffc-list" role="log" aria-live="polite" aria-busy={tail?.streaming || undefined}>
      {messages.length === 0 ? (
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
