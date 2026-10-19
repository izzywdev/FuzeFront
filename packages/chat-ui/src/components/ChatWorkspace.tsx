import React, { useState } from 'react';
import type { UiMessage, CustomToolCard, ThreadSummary } from '../hooks/types';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

export interface ActionChip {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

export interface ChatWorkspaceProps {
  /** Active message history */
  messages: UiMessage[];
  /** Handler when user submits message */
  onSend: (text: string) => void;
  /** Confirmation handlers */
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  /** Feedback handler */
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  /** Stream status */
  status: 'idle' | 'busy' | 'error';
  /** Optional stream cancellation */
  onStop?: () => void;
  /** Optional reset conversation */
  onReset?: () => void;

  /** Thread history */
  threads?: ThreadSummary[];
  activeThreadId?: string;
  onSelectThread?: (threadId: string) => void;
  onNewThread?: () => void;
  onDeleteThread?: (threadId: string) => void;

  /** Workspace metadata */
  title?: string;
  activeModel?: string;
  activePersona?: string;
  availableModels?: string[];
  onSelectModel?: (model: string) => void;

  /** Extensible custom tool card renderer */
  renderCustomCard?: (card: CustomToolCard) => React.ReactNode;

  /** Quick action chips rendered above or within composer */
  actionChips?: ActionChip[];

  /** Right-side drawer / panel */
  rightPanel?: React.ReactNode;
  rightPanelTitle?: string;

  /** Popout window handler */
  onPopoutWindow?: () => void;

  /** Suggested prompts for empty state */
  suggestedPrompts?: string[];
  /** Composer input placeholder */
  placeholder?: string;
  /** Custom root className */
  className?: string;
}

/**
 * Full-viewport Standalone Chat Workspace (OpenWebUI / Claude / Codex style).
 * Features:
 * - Collapsible thread history sidebar
 * - Top navbar with model / persona badge, status indicator, and popout action
 * - Multi-tier message canvas with reasoning chains and custom tool cards
 * - Floating action chips and bottom composer with @mention support
 * - Collapsible right drawer for telemetry / sandboxes
 */
export function ChatWorkspace({
  messages,
  onSend,
  onApprove,
  onCancel,
  onFeedback,
  status,
  onStop,
  onReset,
  threads = [],
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  title = 'FuzeAgent Workspace',
  activeModel = 'claude-3-7-sonnet',
  activePersona = 'IzzyAI Autonomous Assistant',
  availableModels = ['claude-3-7-sonnet', 'claude-3-5-haiku', 'gpt-4o', 'deepseek-r1'],
  onSelectModel,
  renderCustomCard,
  actionChips = [],
  rightPanel,
  rightPanelTitle = 'Workspace Telemetry',
  onPopoutWindow,
  suggestedPrompts = [
    'Analyze cluster pod health in namespace fuzeagent',
    'Review latest pull request changes and run lint suite',
    'Deploy react-dev sandbox and run e2e Playwright tests',
    'Query the cross-functional frontend brain for tokens',
  ],
  placeholder = 'Ask a question, issue a command, or @mention an agent...',
  className = '',
}: ChatWorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  const isStreaming = status === 'busy';

  return (
    <div
      className={`ffc-workspace ${className}`}
      data-sidebar-open={sidebarOpen}
      data-right-open={rightPanelOpen}
      data-testid="chat-workspace-root"
    >
      {/* ------------------------------------------------------------- */}
      {/* Left Sidebar: Thread History & Navigation                      */}
      {/* ------------------------------------------------------------- */}
      <aside
        className={`ffc-workspace__sidebar ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}
        aria-label="Thread history"
      >
        <div className="ffc-workspace__sidebar-header">
          <button
            type="button"
            className="ffc-workspace__new-btn"
            onClick={onNewThread}
            data-testid="new-thread-btn"
          >
            <span aria-hidden="true">➕</span>
            <span>New Chat</span>
          </button>
          <button
            type="button"
            className="ffc-workspace__icon-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            title="Collapse sidebar"
          >
            ◀
          </button>
        </div>

        <div className="ffc-workspace__threads-list">
          {threads.length === 0 ? (
            <div className="ffc-workspace__threads-empty">No previous sessions</div>
          ) : (
            threads.map((t) => {
              const isActive = t.id === activeThreadId;
              return (
                <div
                  key={t.id}
                  className={`ffc-workspace__thread-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelectThread?.(t.id)}
                  role="button"
                  tabIndex={0}
                  data-testid={`thread-item-${t.id}`}
                >
                  <span className="ffc-workspace__thread-icon" aria-hidden="true">
                    💬
                  </span>
                  <div className="ffc-workspace__thread-info">
                    <span className="ffc-workspace__thread-title">{t.title}</span>
                    <span className="ffc-workspace__thread-time">{t.updatedAt}</span>
                  </div>
                  {onDeleteThread && (
                    <button
                      type="button"
                      className="ffc-workspace__thread-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteThread(t.id);
                      }}
                      aria-label={`Delete thread ${t.title}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* Main Canvas Area                                              */}
      {/* ------------------------------------------------------------- */}
      <main className="ffc-workspace__main">
        {/* Top Navbar */}
        <header className="ffc-workspace__navbar">
          <div className="ffc-workspace__nav-left">
            {!sidebarOpen && (
              <button
                type="button"
                className="ffc-workspace__icon-btn"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                title="Expand sidebar"
                data-testid="open-sidebar-btn"
              >
                ☰
              </button>
            )}
            <div className="ffc-workspace__title-group">
              <h1 className="ffc-workspace__title">{title}</h1>
              <span className="ffc-workspace__persona-badge">{activePersona}</span>
            </div>
          </div>

          <div className="ffc-workspace__nav-right">
            {/* Model Selector Pill */}
            <div className="ffc-workspace__model-picker">
              <button
                type="button"
                className="ffc-workspace__model-btn"
                onClick={() => setModelDropdownOpen((v) => !v)}
                aria-expanded={modelDropdownOpen}
                data-testid="model-picker-btn"
              >
                <span className="ffc-workspace__status-dot" data-status={status} />
                <span className="ffc-workspace__model-name">{activeModel}</span>
                <span className="ffc-workspace__arrow" aria-hidden="true">
                  ▾
                </span>
              </button>

              {modelDropdownOpen && (
                <div className="ffc-workspace__model-dropdown" role="menu">
                  {availableModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="menuitem"
                      className={`ffc-workspace__model-option ${m === activeModel ? 'is-selected' : ''}`}
                      onClick={() => {
                        onSelectModel?.(m);
                        setModelDropdownOpen(false);
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pop-out standalone window action */}
            {onPopoutWindow && (
              <button
                type="button"
                className="ffc-workspace__icon-btn"
                onClick={onPopoutWindow}
                aria-label="Open in standalone window"
                title="Open in new window"
                data-testid="popout-window-btn"
              >
                ↗
              </button>
            )}

            {/* Toggle Right Panel */}
            {rightPanel && (
              <button
                type="button"
                className={`ffc-workspace__icon-btn ${rightPanelOpen ? 'is-active' : ''}`}
                onClick={() => setRightPanelOpen((v) => !v)}
                aria-label="Toggle telemetry drawer"
                title="Toggle metrics & telemetry"
                data-testid="toggle-telemetry-btn"
              >
                📊
              </button>
            )}
          </div>
        </header>

        {/* Center Message Feed */}
        <section className="ffc-workspace__feed" aria-label="Conversation feed">
          <MessageList
            messages={messages}
            onApprove={onApprove}
            onCancel={onCancel}
            onFeedback={onFeedback}
            suggestedPrompts={suggestedPrompts}
            onSendPrompt={onSend}
            renderCustomCard={renderCustomCard}
          />
        </section>

        {/* Floating Action Chips & Composer Footer */}
        <footer className="ffc-workspace__footer">
          {actionChips.length > 0 && (
            <div className="ffc-workspace__action-chips">
              {actionChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="ffc-workspace__action-chip"
                  onClick={chip.onClick}
                  data-testid={`action-chip-${chip.id}`}
                >
                  {chip.icon && (
                    <span className="ffc-workspace__chip-icon">{chip.icon}</span>
                  )}
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="ffc-workspace__composer-wrapper">
            <Composer
              onSend={onSend}
              disabled={isStreaming}
              placeholder={placeholder}
              streaming={isStreaming}
              onStop={onStop}
            />
          </div>
        </footer>
      </main>

      {/* ------------------------------------------------------------- */}
      {/* Right Collapsible Panel: Telemetry & Sandboxes               */}
      {/* ------------------------------------------------------------- */}
      {rightPanel && (
        <aside
          className={`ffc-workspace__right-panel ${rightPanelOpen ? 'is-open' : 'is-collapsed'}`}
          aria-label={rightPanelTitle}
        >
          <div className="ffc-workspace__right-header">
            <span className="ffc-workspace__right-title">{rightPanelTitle}</span>
            <button
              type="button"
              className="ffc-workspace__icon-btn"
              onClick={() => setRightPanelOpen(false)}
              aria-label="Close telemetry drawer"
            >
              ✕
            </button>
          </div>
          <div className="ffc-workspace__right-content">{rightPanel}</div>
        </aside>
      )}
    </div>
  );
}
