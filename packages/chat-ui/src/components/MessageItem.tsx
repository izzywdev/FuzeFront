import { useChatI18n } from '../i18n';
import type { UiMessage } from '../hooks/types';
import { Citations } from './Citations';
import { ConfirmationCard } from './ConfirmationCard';
import { FeedbackButtons } from './FeedbackButtons';

export interface MessageItemProps {
  message: UiMessage;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
}

/** A single chat turn: bubble, streaming caret, citations, confirmations, feedback. */
export function MessageItem({ message, onApprove, onCancel, onFeedback }: MessageItemProps) {
  const { strings } = useChatI18n();
  const isAssistant = message.role === 'assistant';
  const roleLabel = isAssistant ? strings.assistantRole : strings.userRole;

  return (
    <article
      className={`ffc-msg ffc-msg--${message.role}`}
      aria-label={roleLabel}
      data-streaming={message.streaming || undefined}
    >
      <span className="ffc-msg__role">{roleLabel}</span>

      <div className="ffc-bubble">
        {message.content}
        {message.streaming ? (
          <span className="ffc-caret" aria-hidden="true" data-testid="ffc-caret" />
        ) : null}
      </div>

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
