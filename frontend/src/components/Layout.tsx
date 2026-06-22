import React from 'react'
import TopBar from './TopBar'
import SidePanel from './SidePanel'
import FuzeChatWidget from './FuzeChatWidget'
import Toaster from './Toaster'

interface LayoutProps {
  children: React.ReactNode
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="app-layout">
      <TopBar />
      <div className="main-content">
        <SidePanel />
        <div className="content-area">{children}</div>
      </div>

      {/* AI assistant — real chat-service backed, design-system @fuzefront/chat-ui.
          Replaces the former simulated ChatPanel/ChatContext. */}
      <FuzeChatWidget />

      {/* Toast region fed by window.__FUZEFRONT__.notify() (host + any app) */}
      <Toaster />
    </div>
  )
}

export default Layout
