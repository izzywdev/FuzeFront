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
}

/**
 * The chat drawer surface: header, message list, composer. Presentational —
 * all state/actions are injected (so it can be driven by useChat or a mock).
 * Rendered inside a dialog landmark; `dir` comes from the i18n provider on the
 * host element so logical-property styles mirror automatically.
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
}: ChatPanelProps) {
  const { strings, dir } = useChatI18n();

  return (
    <aside
      className="ffc-drawer"
      role="dialog"
      aria-label={strings.panelTitle}
      aria-modal="false"
      dir={dir}
    >
      <header className="ffc-header">
        <h2 className="ffc-header__title">{strings.panelTitle}</h2>
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
      />

      <Composer disabled={streaming || loadingHistory} onSend={onSend} />
    </aside>
  );
}
