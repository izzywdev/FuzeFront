import React from 'react'
import TopBar from './TopBar'
import SidePanel from './SidePanel'
import ChatPanel from './ChatPanel'
import { useChat } from '../contexts/ChatContext'

interface LayoutProps {
  children: React.ReactNode
}

function Layout({ children }: LayoutProps) {
  const { state, sendMessage, toggleChat, addFeedback } = useChat()

  return (
    <div className={`app-layout ${state.isOpen ? 'chat-open' : ''}`}>
      <TopBar />
      <div className="main-content">
        <SidePanel />
        <div className="content-area">{children}</div>
      </div>

      {/* Chat Panel */}
      <ChatPanel
        isOpen={state.isOpen}
        onToggle={toggleChat}
        messages={state.messages}
        onSendMessage={sendMessage}
        onFeedback={addFeedback}
        isLoading={state.isLoading}
      />
    </div>
  )
}

export default Layout
