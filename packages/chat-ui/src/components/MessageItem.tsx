import type React from 'react';
import { useChatI18n } from '../i18n';
import type { UiMessage, CustomToolCard } from '../hooks/types';
import { Citations } from './Citations';
import { ConfirmationCard } from './ConfirmationCard';
import { FeedbackButtons } from './FeedbackButtons';
import { renderMessageMarkdown } from '../lib/markdown';

export interface MessageItemProps {
  message: UiMessage;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  onCodeAction?: (code: string, language: string) => void;
  codeActionLabel?: string;
  renderCustomCard?: (card: CustomToolCard) => React.ReactNode;
}

/** Slack/WhatsApp-style short local time, e.g. "10:42 AM". Undefined if unparseable. */
function formatMessageTime(createdAt?: string): string | undefined {
  if (!createdAt) return undefined;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** A single chat turn: bubble, streaming caret, citations, confirmations, feedback. */
export function MessageItem({
  message,
  onApprove,
  onCancel,
  onFeedback,
  onCodeAction,
  codeActionLabel,
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
        <details className="ffc-thought-box" open={message.streaming}>
          <summary className="ffc-thought-box__summary">
            <span className="ffc-thought-box__icon" aria-hidden="true">💭</span>
            <span>Reasoning Chain ({message.thoughts.length} step{message.thoughts.length > 1 ? 's' : ''})</span>
          </summary>
          <div className="ffc-thought-box__content">
            {message.thoughts.map((step, idx) => (
              <div key={idx} className="ffc-thought-box__step">
                {step}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="ffc-bubble">
        {renderMessageMarkdown(message.content, { onCodeAction, codeActionLabel })}
        {message.streaming ? (
          <span className="ffc-caret" aria-hidden="true" data-testid="ffc-caret" />
        ) : null}
      </div>

      {message.cards?.map((card, idx) => (
        <div key={idx} className="ffc-custom-card-slot" data-card-type={card.cardType}>
          {renderCustomCard ? (
            renderCustomCard(card)
          ) : (
            <div className="ffc-default-card">
              <span className="ffc-default-card__badge">{card.cardType}</span>
              <pre className="ffc-default-card__data">{JSON.stringify(card.data, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}

      {message.rawToolOutput ? (
        <details className="ffc-tool-output">
          <summary>Terminal / Tool Execution Log</summary>
          <pre>{message.rawToolOutput}</pre>
        </details>
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
