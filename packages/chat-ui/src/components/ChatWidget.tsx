import { useState, type ReactNode } from 'react';
import type { ChatServiceClient } from '@fuzefront/chat-client';
import { ChatI18nProvider, useChatI18n, type ChatStrings, type Direction } from '../i18n';
import { useChat } from '../hooks/useChat';
import type { InjectedChatEvent } from '../hooks/useChat';
import type { CustomToolCard } from '../hooks/types';
import { ChatPanel } from './ChatPanel';

export interface ChatWidgetProps {
  /** A configured chat-service client (baseUrl + getToken). */
  client: ChatServiceClient;
  /** Tenant the conversation belongs to. */
  orgId: string;
  /**
   * Consuming application ('fuzefront', 'mendys', ...). Scopes stored history
   * to (user, org, app) so each app resumes only its own thread.
   */
  appId?: string;
  /** Resume an existing conversation. */
  conversationId?: string;
  /**
   * Load persisted history when the panel opens (WhatsApp-style resume of the
   * scope's most recent conversation). Default true.
   */
  resume?: boolean;
  /** History page size for the initial load and each infinite-scroll page. */
  pageSize?: number;
  /** Start open. Default false (launcher-driven). */
  defaultOpen?: boolean;
  /** Text direction; forwarded to i18n + the drawer root. Default 'ltr'. */
  dir?: Direction;
  /** Optional string overrides (e.g. localized copy from the host). */
  strings?: Partial<ChatStrings>;
  /** Optional custom card renderer for domain-specific tool cards. */
  renderCustomCard?: (card: CustomToolCard) => ReactNode;
  /** Surface errors to the host (toasts, logging). */
  onError?: (message: string) => void;
  /** Subscribe to persisted Kafka/WebSocket assistant response chunks. */
  subscribeInjected?: (handler: (event: InjectedChatEvent) => void) => () => void;
}

/** Floating launcher + drawer, self-contained: provides i18n and drives useChat. */
export function ChatWidget({
  client,
  orgId,
  appId,
  conversationId,
  resume = true,
  pageSize,
  defaultOpen = false,
  dir = 'ltr',
  strings,
  renderCustomCard,
  onError,
  subscribeInjected,
}: ChatWidgetProps) {
  return (
    <ChatI18nProvider dir={dir} strings={strings}>
      <ChatWidgetInner
        client={client}
        orgId={orgId}
        appId={appId}
        conversationId={conversationId}
        resume={resume}
        pageSize={pageSize}
        defaultOpen={defaultOpen}
        renderCustomCard={renderCustomCard}
        onError={onError}
        subscribeInjected={subscribeInjected}
      />
    </ChatI18nProvider>
  );
}

function ChatWidgetInner({
  client,
  orgId,
  appId,
  conversationId,
  resume,
  pageSize,
  defaultOpen,
  renderCustomCard,
  onError,
  subscribeInjected,
}: Pick<
  ChatWidgetProps,
  | 'client'
  | 'orgId'
  | 'appId'
  | 'conversationId'
  | 'resume'
  | 'pageSize'
  | 'defaultOpen'
  | 'renderCustomCard'
  | 'onError'
  | 'subscribeInjected'
>) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const { strings, dir } = useChatI18n();
  const chat = useChat({ client, orgId, appId, conversationId, resume, pageSize, onError, subscribeInjected });

  if (!open) {
    return (
      <button
        type="button"
        className="ffc-launcher"
        aria-label={strings.openLabel}
        dir={dir}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">💬</span>
      </button>
    );
  }

  return (
    <ChatPanel
      messages={chat.messages}
      streaming={chat.streaming}
      loadingHistory={chat.loadingHistory}
      hasMoreBefore={chat.hasMoreBefore}
      hasMoreAfter={chat.hasMoreAfter}
      onLoadOlder={chat.loadOlder}
      onLoadNewer={chat.loadNewer}
      sendSignal={chat.sendCount}
      renderCustomCard={renderCustomCard}
      onSend={chat.send}
      onApprove={chat.confirm}
      onCancel={chat.cancel}
      onFeedback={chat.feedback}
      onClose={() => setOpen(false)}
    />
  );
}

