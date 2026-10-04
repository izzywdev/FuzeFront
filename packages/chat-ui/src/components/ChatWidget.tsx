import { useState } from 'react';
import type { ChatServiceClient } from '@fuzefront/chat-client';
import { ChatI18nProvider, useChatI18n, type ChatStrings, type Direction } from '../i18n';
import { useChat } from '../hooks/useChat';
import type { InjectedChatEvent } from '../hooks/useChat';
import { ChatPanel } from './ChatPanel';

export interface ChatWidgetProps {
  /** A configured chat-service client (baseUrl + getToken). */
  client: ChatServiceClient;
  /** Tenant the conversation belongs to. */
  orgId: string;
  /**
   * Consuming application ('fuzefront', 'fuzebi', 'mendys', ...). Scopes stored history
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
  /** Start open. Default false (launcher-driven) for 'drawer', always open for 'inline'. */
  defaultOpen?: boolean;
  /** Text direction; forwarded to i18n + the drawer root. Default 'ltr'. */
  dir?: Direction;
  /** Optional string overrides (e.g. localized copy from the host). */
  strings?: Partial<ChatStrings>;
  /** Surface errors to the host (toasts, logging). */
  onError?: (message: string) => void;
  /** Subscribe to persisted Kafka/WebSocket assistant response chunks. */
  subscribeInjected?: (handler: (event: InjectedChatEvent) => void) => () => void;
  /** Rendering variant: 'drawer' (floating launcher + flyout) or 'inline' (embedded card). */
  variant?: 'drawer' | 'inline';
  /** Custom title for the panel header. */
  title?: string;
  /** Optional subtitle below header title. */
  subtitle?: string;
  /** Suggested questions rendered when conversation is empty. */
  suggestedPrompts?: string[];
  /** Handler when user clicks query execution inside code blocks. */
  onCodeAction?: (code: string, language: string) => void;
  /** Custom label for the code action button. */
  codeActionLabel?: string;
  /** Callback when panel is closed (only applicable if closeable). */
  onClose?: () => void;
}

/** Floating launcher + drawer, or embedded inline panel. Self-contained: provides i18n and drives useChat. */
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
  onError,
  subscribeInjected,
  variant = 'drawer',
  title,
  subtitle,
  suggestedPrompts,
  onCodeAction,
  codeActionLabel,
  onClose,
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
        defaultOpen={variant === 'inline' ? true : defaultOpen}
        onError={onError}
        subscribeInjected={subscribeInjected}
        variant={variant}
        title={title}
        subtitle={subtitle}
        suggestedPrompts={suggestedPrompts}
        onCodeAction={onCodeAction}
        codeActionLabel={codeActionLabel}
        onClose={onClose}
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
  onError,
  subscribeInjected,
  variant = 'drawer',
  title,
  subtitle,
  suggestedPrompts,
  onCodeAction,
  codeActionLabel,
  onClose,
}: Pick<
  ChatWidgetProps,
  | 'client'
  | 'orgId'
  | 'appId'
  | 'conversationId'
  | 'resume'
  | 'pageSize'
  | 'defaultOpen'
  | 'onError'
  | 'subscribeInjected'
  | 'variant'
  | 'title'
  | 'subtitle'
  | 'suggestedPrompts'
  | 'onCodeAction'
  | 'codeActionLabel'
  | 'onClose'
>) {
  const isInline = variant === 'inline';
  const [open, setOpen] = useState(Boolean(defaultOpen || isInline));
  const { strings, dir } = useChatI18n();
  const chat = useChat({ client, orgId, appId, conversationId, resume, pageSize, onError, subscribeInjected });

  if (!open && !isInline) {
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
      variant={variant}
      title={title}
      subtitle={subtitle}
      suggestedPrompts={suggestedPrompts}
      onCodeAction={onCodeAction}
      codeActionLabel={codeActionLabel}
      messages={chat.messages}
      streaming={chat.streaming}
      loadingHistory={chat.loadingHistory}
      hasMoreBefore={chat.hasMoreBefore}
      hasMoreAfter={chat.hasMoreAfter}
      onLoadOlder={chat.loadOlder}
      onLoadNewer={chat.loadNewer}
      sendSignal={chat.sendCount}
      onSend={chat.send}
      onApprove={chat.confirm}
      onCancel={chat.cancel}
      onFeedback={chat.feedback}
      onClose={isInline && !onClose ? undefined : () => {
        setOpen(false);
        onClose?.();
      }}
    />
  );
}
