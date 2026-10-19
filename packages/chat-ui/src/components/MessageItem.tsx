import type { ReactNode } from 'react';
import { useChatI18n } from '../i18n';
import type { CustomToolCard, UiMessage } from '../hooks/types';
import { Citations } from './Citations';
import { ConfirmationCard } from './ConfirmationCard';
import { FeedbackButtons } from './FeedbackButtons';
import { ThoughtBox } from './ThoughtBox';
import { renderInlineMarkdown } from '../lib/markdown';

export interface MessageItemProps {
  message: UiMessage;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  renderCustomCard?: (card: CustomToolCard) => ReactNode;
}

/** Slack/WhatsApp-style short local time, e.g. "10:42 AM". Undefined if unparseable. */
function formatMessageTime(createdAt?: string): string | undefined {
  if (!createdAt) return undefined;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** A single chat turn: bubble, streaming caret, citations, confirmations, thoughts, custom cards, feedback. */
export function MessageItem({
  message,
  onApprove,
  onCancel,
  onFeedback,
  renderCustomCard,
}: MessageItemProps) {
  const { strings } = useChatI18n();
  const isAssistant = message.role === 'assistant';
  const roleLabel = isAssistant ? strings.assistantRole : strings.userRole;
  const timeLabel = formatMessageTime(message.createdAt);

  return (
    <article
      className={`ffc-msg ffc-msg--${message.role}`}
      aria-label={roleLabel}
      data-streaming={message.streaming || undefined}
    >
      <div className="ffc-msg__meta">
        <span className="ffc-msg__role">{roleLabel}</span>
        {timeLabel ? (
          <time className="ffc-msg__time" dateTime={message.createdAt}>
            {timeLabel}
          </time>
        ) : null}
      </div>

      {message.thoughts && message.thoughts.length > 0 ? (
        <ThoughtBox thoughts={message.thoughts} />
      ) : null}

      <div className="ffc-bubble">
        {renderInlineMarkdown(message.content)}
        {message.streaming ? (
          <span className="ffc-caret" aria-hidden="true" data-testid="ffc-caret" />
        ) : null}
      </div>

      {message.cards && message.cards.length > 0 ? (
        <div className="ffc-cards-container">
          {message.cards.map((card) => (
            <div key={card.id} className="ffc-card-host" data-card-type={card.type}>
              {renderCustomCard ? (
                renderCustomCard(card)
              ) : (
                <div className="ffc-card-default">
                  <strong>{card.title || card.type}</strong>
                  <pre>{JSON.stringify(card.data, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {message.sources && message.sources.length > 0 ? (
        <Citations sources={message.sources} />
      ) : null}

      {message.confirmations?.map((c) => (
        <ConfirmationCard
          key={c.confirmationId}
          confirmation={c}
          onApprove={onApprove}
          onCancel={onCancel}
        />
      ))}

      {message.error ? (
        <p className="ffc-error" role="alert">
          {strings.errorPrefix}: {message.error}
        </p>
      ) : null}

      {isAssistant && !message.streaming && !message.error ? (
        <FeedbackButtons
          messageId={message.id}
          value={message.feedback}
          onFeedback={onFeedback}
        />
      ) : null}
    </article>
  );
}

