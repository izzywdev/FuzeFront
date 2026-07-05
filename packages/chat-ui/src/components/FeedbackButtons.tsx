import { useChatI18n } from '../i18n';

export interface FeedbackButtonsProps {
  messageId: string;
  value?: 'positive' | 'negative';
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
}

/** Thumbs up/down feedback for an assistant message (POST /chat/feedback). */
export function FeedbackButtons({ messageId, value, onFeedback }: FeedbackButtonsProps) {
  const { strings } = useChatI18n();
  return (
    <div className="ffc-feedback">
      <button
        type="button"
        className="ffc-feedback__btn"
        aria-label={strings.feedbackPositive}
        aria-pressed={value === 'positive'}
        onClick={() => onFeedback(messageId, 'positive')}
      >
        <span aria-hidden="true">👍</span>
      </button>
      <button
        type="button"
        className="ffc-feedback__btn"
        aria-label={strings.feedbackNegative}
        aria-pressed={value === 'negative'}
        onClick={() => onFeedback(messageId, 'negative')}
      >
        <span aria-hidden="true">👎</span>
      </button>
    </div>
  );
}
