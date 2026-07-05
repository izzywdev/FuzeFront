/**
 * @fuzefront/chat-ui — design-system-first React chat UI for the FuzeFront
 * chat-service. Consumes @fuzefront/chat-client's SSE event union; renders
 * streaming messages, RAG citations, and agent confirmation prompts using only
 * @fuzefront/design-system tokens.
 *
 * Consumers must also import the stylesheet once:
 *   import '@fuzefront/chat-ui/styles.css';
 */

// High-level, self-contained widget (launcher + drawer + state).
export { ChatWidget } from './components/ChatWidget';
export type { ChatWidgetProps } from './components/ChatWidget';

// Presentational + composite components (for custom layouts).
export { ChatPanel } from './components/ChatPanel';
export type { ChatPanelProps } from './components/ChatPanel';
export { MessageList } from './components/MessageList';
export type { MessageListProps } from './components/MessageList';
export { MessageItem } from './components/MessageItem';
export type { MessageItemProps } from './components/MessageItem';
export { Composer } from './components/Composer';
export type { ComposerProps } from './components/Composer';
export { Citations } from './components/Citations';
export type { CitationsProps } from './components/Citations';
export { ConfirmationCard } from './components/ConfirmationCard';
export type { ConfirmationCardProps } from './components/ConfirmationCard';
export { FeedbackButtons } from './components/FeedbackButtons';
export type { FeedbackButtonsProps } from './components/FeedbackButtons';

// Hooks + reducer (drive a custom UI directly).
export { useChat } from './hooks/useChat';
export type { UseChatOptions, UseChatResult } from './hooks/useChat';
export { chatReducer, initialModel } from './hooks/chatReducer';
export type { ChatModel, ChatAction } from './hooks/chatReducer';
export type { UiMessage, PendingConfirmation, RagSource } from './hooks/types';

// i18n / direction.
export { ChatI18nProvider, useChatI18n } from './i18n';
export type { ChatI18nProviderProps, ChatStrings, Direction, I18nContextValue } from './i18n';
