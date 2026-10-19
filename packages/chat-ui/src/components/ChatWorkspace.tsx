import { useState, useId, type ReactNode } from 'react';
import { useChatI18n } from '../i18n';
import type { ChatThread, CustomToolCard, UiMessage } from '../hooks/types';
import { MessageList } from './MessageList';

export interface ChatModelOption {
  id: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface ChatWorkspaceProps {
  messages: UiMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onApprove: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
  onFeedback: (messageId: string, rating: 'positive' | 'negative') => void;
  renderCustomCard?: (card: CustomToolCard) => ReactNode;

  /** Thread history */
  threads?: ChatThread[];
  activeThreadId?: string;
  onSelectThread?: (threadId: string) => void;
  onNewThread?: () => void;
  onDeleteThread?: (threadId: string) => void;

  /** Model selector */
  models?: ChatModelOption[];
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;

  /** Header title & extras */
  title?: string;
  subtitle?: string;
  onPopOut?: () => void;
  showPopOut?: boolean;
  headerActions?: ReactNode;
  inspectorContent?: ReactNode;
  composerAddons?: ReactNode;

  /** Infinite scroll & paging */
  loadingHistory?: boolean;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  onLoadOlder?: () => void;
  onLoadNewer?: () => void;
  sendSignal?: number;
}

/**
 * Standalone, full-viewport chat workspace (OpenWebUI / Claude / Codex style).
 * Includes collapsible thread history sidebar, model switcher, message stream with
 * tool cards and reasoning accordions, and action-pill composer.
 */
export function ChatWorkspace({
  messages,
  streaming,
  onSend,
  onApprove,
  onCancel,
  onFeedback,
  renderCustomCard,
  threads = [],
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  models = [
    { id: 'fuzeagent-multi-agent', label: 'FuzeAgent Multi-Agent', icon: '🤖' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', icon: '⚡' },
    { id: 'gpt-4o', label: 'GPT-4o', icon: '🧠' },
  ],
  selectedModel,
  onSelectModel,
  title = 'FuzeAgent Chat',
  subtitle = 'Cluster Orchestration Agent',
  onPopOut,
  showPopOut = true,
  headerActions,
  inspectorContent,
  composerAddons,
  loadingHistory = false,
  hasMoreBefore = false,
  hasMoreAfter = false,
  onLoadOlder,
  onLoadNewer,
  sendSignal,
}: ChatWorkspaceProps) {
  const { dir } = useChatI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [input, setInput] = useState('');
  const [currentModel, setCurrentModel] = useState(selectedModel || models[0]?.id || 'default');
  const textareaId = useId();

  const handleModelChange = (modelId: string) => {
    setCurrentModel(modelId);
    onSelectModel?.(modelId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || loadingHistory) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <div className="ffc-workspace" dir={dir}>
      {/* Collapsible Left Thread Sidebar */}
      <aside
        className={`ffc-workspace__sidebar ${sidebarOpen ? 'ffc-workspace__sidebar--open' : 'ffc-workspace__sidebar--collapsed'}`}
        aria-label="Conversation History"
      >
        <div className="ffc-workspace__sidebar-header">
          <div className="ffc-workspace__brand">
            <span className="ffc-workspace__brand-icon">⚡</span>
            <span className="ffc-workspace__brand-text">FuzeAgent</span>
          </div>
          <button
            type="button"
            className="ffc-workspace__new-btn"
            onClick={onNewThread}
            aria-label="New Chat"
            title="New Chat (⌘K)"
          >
            <span aria-hidden="true">+</span>
            <span className="ffc-workspace__new-btn-text">New Chat</span>
          </button>
        </div>

        {/* Model Picker */}
        <div className="ffc-workspace__model-picker">
          <label htmlFor="ffc-model-select" className="ffc-workspace__model-label">
            Model:
          </label>
          <select
            id="ffc-model-select"
            className="ffc-workspace__model-select"
            value={currentModel}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.icon ? `${m.icon} ` : ''}{m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Threads List */}
        <div className="ffc-workspace__threads" role="navigation" aria-label="Recent threads">
          <div className="ffc-workspace__threads-section">Recent Chats</div>
          {threads.length === 0 ? (
            <div className="ffc-workspace__no-threads">No recent chats</div>
          ) : (
            <ul className="ffc-workspace__thread-list">
              {threads.map((t) => {
                const isActive = t.id === activeThreadId;
                return (
                  <li key={t.id} className="ffc-workspace__thread-item">
                    <button
                      type="button"
                      className={`ffc-workspace__thread-btn ${isActive ? 'ffc-workspace__thread-btn--active' : ''}`}
                      onClick={() => onSelectThread?.(t.id)}
                    >
                      <span className="ffc-workspace__thread-title">{t.title || 'Untitled Chat'}</span>
                      {t.unreadCount ? (
                        <span className="ffc-workspace__thread-badge">{t.unreadCount}</span>
                      ) : null}
                    </button>
                    {onDeleteThread ? (
                      <button
                        type="button"
                        className="ffc-workspace__thread-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteThread(t.id);
                        }}
                        aria-label="Delete chat"
                        title="Delete chat"
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Chat Canvas */}
      <main className="ffc-workspace__canvas">
        {/* Canvas Header */}
        <header className="ffc-workspace__header">
          <div className="ffc-workspace__header-start">
            <button
              type="button"
              className="ffc-iconbtn ffc-workspace__sidebar-toggle"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              ☰
            </button>
            <div className="ffc-workspace__header-titles">
              <h1 className="ffc-workspace__title">{title}</h1>
              {subtitle && <span className="ffc-workspace__subtitle">{subtitle}</span>}
            </div>
            {streaming && (
              <span className="ffc-workspace__status-badge">
                <span className="ffc-workspace__status-dot" aria-hidden="true" />
                streaming
              </span>
            )}
          </div>

          <div className="ffc-workspace__header-actions">
            {headerActions}
            {inspectorContent && (
              <button
                type="button"
                className={`ffc-iconbtn ${inspectorOpen ? 'ffc-iconbtn--active' : ''}`}
                onClick={() => setInspectorOpen((prev) => !prev)}
                aria-label="Toggle telemetry"
                title="Toggle telemetry & diagnostics"
              >
                📊
              </button>
            )}
            {showPopOut && onPopOut && (
              <button
                type="button"
                className="ffc-iconbtn"
                onClick={onPopOut}
                aria-label="Open in new window"
                title="Pop out standalone window"
              >
                ⤢
              </button>
            )}
          </div>
        </header>

        {/* Message Canvas Stream */}
        <div className="ffc-workspace__messages">
          <MessageList
            messages={messages}
            onApprove={onApprove}
            onCancel={onCancel}
            onFeedback={onFeedback}
            renderCustomCard={renderCustomCard}
            loadingHistory={loadingHistory}
            hasMoreBefore={hasMoreBefore}
            hasMoreAfter={hasMoreAfter}
            onLoadOlder={onLoadOlder}
            onLoadNewer={onLoadNewer}
            sendSignal={sendSignal}
          />
        </div>

        {/* Floating Composer */}
        <div className="ffc-workspace__composer-wrapper">
          <div className="ffc-workspace__composer-box">
            {/* Action Pills */}
            <div className="ffc-workspace__pills">
              <span className="ffc-workspace__pill ffc-workspace__pill--accent">
                @ Agent Mention
              </span>
              <span className="ffc-workspace__pill">
                ⚙️ Sandbox: K8s Isolated
              </span>
              <span className="ffc-workspace__pill">
                🌐 Web Search
              </span>
              {composerAddons}
            </div>

            {/* Input area */}
            <div className="ffc-workspace__input-row">
              <textarea
                id={textareaId}
                className="ffc-workspace__textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask FuzeAgent anything, or trigger actions with @agent or /cmd..."
                rows={2}
                disabled={streaming || loadingHistory}
                aria-label="Message composer"
              />
              <button
                type="button"
                className="ffc-workspace__send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() || streaming || loadingHistory}
                aria-label="Send message"
              >
                <span aria-hidden="true">➤</span>
              </button>
            </div>
            <div className="ffc-workspace__composer-hint">
              <span>Enter to send · Shift+Enter for new line · Token stream protected</span>
            </div>
          </div>
        </div>
      </main>

      {/* Optional Right Diagnostics / Telemetry Inspector */}
      {inspectorContent && inspectorOpen && (
        <aside className="ffc-workspace__inspector" aria-label="Telemetry and diagnostics">
          <div className="ffc-workspace__inspector-header">
            <h3 className="ffc-workspace__inspector-title">Telemetry & Sandbox</h3>
            <button
              type="button"
              className="ffc-iconbtn"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close inspector"
            >
              ×
            </button>
          </div>
          <div className="ffc-workspace__inspector-body">
            {inspectorContent}
          </div>
        </aside>
      )}
    </div>
  );
}
