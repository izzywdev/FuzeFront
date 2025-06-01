import React, { useState, useRef, useEffect } from 'react'
import { ChatPanelProps } from '../types/chat'

const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  onToggle,
  messages = [],
  onSendMessage,
  onFeedback,
  isLoading = false,
}) => {
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isLoading) {
      onSendMessage(inputValue.trim())
      setInputValue('')
    }
  }

  const formatTime = (timestamp: Date) => {
    return timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleFeedback = (messageId: string, type: 'positive' | 'negative') => {
    onFeedback?.(messageId, type)
  }

  return (
    <div className={`chat-panel ${isOpen ? 'open' : 'closed'}`}>
      {/* Chat Panel Header */}
      <div className="chat-header">
        <h3>🤖 AI Assistant</h3>
        <button
          className="chat-toggle-btn"
          onClick={onToggle}
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
        >
          {isOpen ? '✕' : '💬'}
        </button>
      </div>

      {/* Chat Messages Area */}
      {isOpen && (
        <>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-message">
                  👋 Hello! I'm your AI assistant. How can I help you with
                  FrontFuse today?
                </div>
              </div>
            ) : (
              messages.map(message => (
                <div
                  key={message.id}
                  className={`chat-message ${message.sender}`}
                >
                  <div className="message-header">
                    <span className="message-sender">
                      {message.sender === 'user' ? '👤 You' : '🤖 AI'}
                    </span>
                    <span className="message-time">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>

                  <div className="message-content">{message.content}</div>

                  {/* Feedback for AI messages */}
                  {message.sender === 'assistant' && (
                    <div className="message-feedback">
                      <button
                        className={`feedback-btn ${message.feedback === 'positive' ? 'active' : ''}`}
                        onClick={() => handleFeedback(message.id, 'positive')}
                        title="Helpful response"
                      >
                        👍
                      </button>
                      <button
                        className={`feedback-btn ${message.feedback === 'negative' ? 'active' : ''}`}
                        onClick={() => handleFeedback(message.id, 'negative')}
                        title="Not helpful"
                      >
                        👎
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="chat-message assistant">
                <div className="message-header">
                  <span className="message-sender">🤖 AI</span>
                  <span className="message-time">typing...</span>
                </div>
                <div className="message-content loading">
                  <span className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Area */}
          <div className="chat-input-area">
            <form onSubmit={handleSubmit} className="chat-form">
              <div className="input-container">
                <textarea
                  className="chat-input"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="Ask me anything about FrontFuse..."
                  rows={2}
                  disabled={isLoading}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit(e)
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-btn"
                  disabled={!inputValue.trim() || isLoading}
                  title="Send message (Enter)"
                >
                  {isLoading ? '⏳' : '🚀'}
                </button>
              </div>
              <div className="input-hint">
                Press Enter to send, Shift+Enter for new line
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}

export default ChatPanel
