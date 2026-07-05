/**
 * Lightweight i18n + direction layer for @fuzefront/chat-ui.
 *
 * `@fuzefront/i18n` does not yet exist on this branch. This module mirrors the
 * interface we expect it to expose (a `dir` + a `t(key)` string lookup) so that
 * when the shared package lands, swapping it in is a one-line import change and
 * the component API does not move. All user-facing strings live here; components
 * never hard-code copy.
 *
 * RTL is handled purely via CSS logical properties in the stylesheet — `dir` is
 * only forwarded to the root element so the browser mirrors automatically.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react';

export type Direction = 'ltr' | 'rtl';

/** All translatable strings the chat UI renders. */
export interface ChatStrings {
  panelTitle: string;
  openLabel: string;
  closeLabel: string;
  composerPlaceholder: string;
  sendLabel: string;
  stopLabel: string;
  thinking: string;
  sourcesHeading: string;
  sourceOpenLabel: string;
  confirmHeading: string;
  confirmApprove: string;
  confirmCancel: string;
  confirmRunning: string;
  toolApproved: string;
  toolDenied: string;
  feedbackPositive: string;
  feedbackNegative: string;
  errorPrefix: string;
  emptyState: string;
  assistantRole: string;
  userRole: string;
}

const EN: ChatStrings = {
  panelTitle: 'Assistant',
  openLabel: 'Open assistant',
  closeLabel: 'Close assistant',
  composerPlaceholder: 'Ask about FuzeFront…',
  sendLabel: 'Send message',
  stopLabel: 'Stop',
  thinking: 'Thinking…',
  sourcesHeading: 'Sources',
  sourceOpenLabel: 'Open source',
  confirmHeading: 'Confirm action',
  confirmApprove: 'Approve',
  confirmCancel: 'Cancel',
  confirmRunning: 'Running…',
  toolApproved: 'Action completed',
  toolDenied: 'Action not permitted',
  feedbackPositive: 'Good response',
  feedbackNegative: 'Bad response',
  errorPrefix: 'Something went wrong',
  emptyState: 'Ask a question to get started.',
  assistantRole: 'Assistant',
  userRole: 'You',
};

export interface I18nContextValue {
  dir: Direction;
  strings: ChatStrings;
}

const defaultValue: I18nContextValue = { dir: 'ltr', strings: EN };

const I18nContext = createContext<I18nContextValue>(defaultValue);

export interface ChatI18nProviderProps {
  dir?: Direction;
  /** Partial overrides merged over the built-in English strings. */
  strings?: Partial<ChatStrings>;
  children: ReactNode;
}

export function ChatI18nProvider({ dir = 'ltr', strings, children }: ChatI18nProviderProps) {
  const value: I18nContextValue = {
    dir,
    strings: strings ? { ...EN, ...strings } : EN,
  };
  return createElement(I18nContext.Provider, { value }, children);
}

export function useChatI18n(): I18nContextValue {
  return useContext(I18nContext);
}
