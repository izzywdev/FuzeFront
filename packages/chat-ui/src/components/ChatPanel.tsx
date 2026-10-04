import { useChatI18n } from '../i18n';
import type { UiMessage } from '../hooks/types';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

export interface ChatPanelProps {
  messages: UiMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  onClose?: () => void;
  /** True while the initial history page is loading (composer disabled). */
  loadingHistory?: boolean;
  /** Older history exists — enables scroll-up paging in the list. */
  hasMoreBefore?: boolean;
  /** Newer history exists — enables scroll-down paging in the list. */
  hasMoreAfter?: boolean;
  onLoadOlder?: () => void;
  onLoadNewer?: () => void;
  /** Increments per locally-sent user message; forces scroll-to-bottom. */
  sendSignal?: number;
  /** Rendering variant: 'drawer' (default floating drawer) or 'inline' (embedded in page). */
  variant?: 'drawer' | 'inline';
  /** Custom title for the panel header (overrides i18n panelTitle). */
  title?: string;
  /** Optional secondary subtitle below the title. */
  subtitle?: string;
  /** Suggested questions displayed when the conversation is empty. */
  suggestedPrompts?: string[];
  /** Handler when user clicks an action inside a code block (e.g. Run Query). */
  onCodeAction?: (code: string, language: string) => void;
  /** Label for the code action button (e.g. "Run in Query Lab"). */
  codeActionLabel?: string;
}

/**
 * The chat drawer or inline surface: header, message list, composer. Presentational —
 * all state/actions are injected (so it can be driven by useChat or a mock).
 * When variant="inline", behaves as an embedded container surface filling parent dimensions.
 */
export function ChatPanel({
  messages,
  streaming,
  onSend,
  onApprove,
  onCancel,
  onFeedback,
  onClose,
  loadingHistory = false,
  hasMoreBefore = false,
  hasMoreAfter = false,
  onLoadOlder,
  onLoadNewer,
  sendSignal,
  variant = 'drawer',
  title,
  subtitle,
  suggestedPrompts,
  onCodeAction,
  codeActionLabel,
}: ChatPanelProps) {
  const { strings, dir } = useChatI18n();
  const displayTitle = title || strings.panelTitle;

  return (
    <aside
      className={`ffc-drawer ${variant === 'inline' ? 'ffc-drawer--inline' : ''}`}
      role={variant === 'drawer' ? 'dialog' : 'region'}
      aria-label={displayTitle}
      aria-modal={variant === 'drawer' ? 'false' : undefined}
      dir={dir}
    >
      <header className="ffc-header">
        <div className="ffc-header__text">
          <h2 className="ffc-header__title">{displayTitle}</h2>
          {subtitle && <p className="ffc-header__subtitle">{subtitle}</p>}
        </div>
        {onClose ? (
          <button
            type="button"
            className="ffc-iconbtn"
            onClick={onClose}
            aria-label={strings.closeLabel}
          >
            <span aria-hidden="true">✕</span>
          </button>
        ) : null}
      </header>

      <MessageList
        messages={messages}
        onApprove={onApprove}
        onCancel={onCancel}
        onFeedback={onFeedback}
        loadingHistory={loadingHistory}
        hasMoreBefore={hasMoreBefore}
        hasMoreAfter={hasMoreAfter}
        onLoadOlder={onLoadOlder}
        onLoadNewer={onLoadNewer}
        sendSignal={sendSignal}
        suggestedPrompts={suggestedPrompts}
        onSendPrompt={onSend}
        onCodeAction={onCodeAction}
        codeActionLabel={codeActionLabel}
      />

      <Composer disabled={streaming || loadingHistory} onSend={onSend} />
    </aside>
  );
}
