import React, { useState } from 'react'
import TopBar from './TopBar'
import SidePanel from './SidePanel'
import FuzeChatWidget from './FuzeChatWidget'
import Toaster from './Toaster'
import { useActiveApp } from '../platform/useActiveApp'
import { isTopbarHidden } from '../platform/appManifest'

interface LayoutProps {
  children: React.ReactNode
}

function Layout({ children }: LayoutProps) {
  const activeApp = useActiveApp()
  // Honor the active portal app's chrome.topbar = "hidden" (the side menu is
  // still managed by SidePanel's own substitution logic).
  const hideTopBar = !!activeApp && isTopbarHidden(activeApp.manifest)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const closeSidebar = () => setIsSidebarOpen(false)
  const toggleSidebar = () => setIsSidebarOpen(prev => !prev)

  return (
    <div className="app-layout">
      {!hideTopBar && <TopBar onMenuToggle={toggleSidebar} />}
      <div className="main-content">
        <SidePanel isOpen={isSidebarOpen} onClose={closeSidebar} />
        {/* Scrim: visible only on mobile when drawer is open */}
        {isSidebarOpen && (
          <div className="sidebar-scrim" onClick={closeSidebar} aria-hidden="true" />
        )}
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
