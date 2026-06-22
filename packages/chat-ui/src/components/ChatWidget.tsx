import { useState } from 'react';
import type { ChatServiceClient } from '@fuzefront/chat-client';
import { ChatI18nProvider, useChatI18n, type ChatStrings, type Direction } from '../i18n';
import { useChat } from '../hooks/useChat';
import { ChatPanel } from './ChatPanel';

export interface ChatWidgetProps {
  /** A configured chat-service client (baseUrl + getToken). */
  client: ChatServiceClient;
  /** Tenant the conversation belongs to. */
  orgId: string;
  /** Resume an existing conversation. */
  conversationId?: string;
  /** Start open. Default false (launcher-driven). */
  defaultOpen?: boolean;
  /** Text direction; forwarded to i18n + the drawer root. Default 'ltr'. */
  dir?: Direction;
  /** Optional string overrides (e.g. localized copy from the host). */
  strings?: Partial<ChatStrings>;
  /** Surface errors to the host (toasts, logging). */
  onError?: (message: string) => void;
}

/** Floating launcher + drawer, self-contained: provides i18n and drives useChat. */
export function ChatWidget({
  client,
  orgId,
  conversationId,
  defaultOpen = false,
  dir = 'ltr',
  strings,
  onError,
}: ChatWidgetProps) {
  return (
    <ChatI18nProvider dir={dir} strings={strings}>
      <ChatWidgetInner
        client={client}
        orgId={orgId}
        conversationId={conversationId}
        defaultOpen={defaultOpen}
        onError={onError}
      />
    </ChatI18nProvider>
  );
}

function ChatWidgetInner({
  client,
  orgId,
  conversationId,
  defaultOpen,
  onError,
}: Pick<ChatWidgetProps, 'client' | 'orgId' | 'conversationId' | 'defaultOpen' | 'onError'>) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const { strings, dir } = useChatI18n();
  const chat = useChat({ client, orgId, conversationId, onError });

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
      onSend={chat.send}
      onApprove={chat.confirm}
      onCancel={chat.cancel}
      onFeedback={chat.feedback}
      onClose={() => setOpen(false)}
    />
  );
}
