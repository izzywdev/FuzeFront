import React, { useState } from 'react'
import TopBar from './TopBar'
import SidePanel from './SidePanel'
import FuzeChatWidget from './FuzeChatWidget'
import Toaster from './Toaster'
import { useActiveApp } from '../platform/useActiveApp'
import { isTopbarHidden } from '../platform/appManifest'
import { PortalBrandingProvider, PortalThemeScope, usePortalContext } from '@fuzefront/portal-branding-ui'
import { useFlag } from '../platform/featureFlags'

interface LayoutProps {
  children: React.ReactNode
}

function Layout({ children }: LayoutProps) {
  // White-label portal branding boot (FF-EPIC-13/FF-EPIC-10) for the
  // AUTHENTICATED shell — behind fuzefront.platform.multi-tenant-portals
  // (default OFF). The authenticated path can use the real, tamper-proof
  // useFlag() (unlike the pre-auth PortalShell/PortalLoginFlow routes in
  // App.tsx, which can't reach the token-gated /api/flags before login).
  // OFF keeps PortalBrandingProvider's status 'disabled', so TopBar and
  // FederatedAppLoader fall back to their existing hardcoded rendering —
  // today's shell, unchanged.
  const multiTenantPortals = useFlag('fuzefront.platform.multi-tenant-portals', false)

  return (
    <PortalBrandingProvider enabled={multiTenantPortals}>
      <PortalScopedLayout>{children}</PortalScopedLayout>
    </PortalBrandingProvider>
  )
}

function PortalScopedLayout({ children }: LayoutProps) {
  const activeApp = useActiveApp()
  // Honor the active portal app's chrome.topbar = "hidden" (the side menu is
  // still managed by SidePanel's own substitution logic).
  const hideTopBar = !!activeApp && isTopbarHidden(activeApp.manifest)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const closeSidebar = () => setIsSidebarOpen(false)
  const toggleSidebar = () => setIsSidebarOpen(prev => !prev)

  // Only apply the [data-portal] accent-token override once branding has
  // actually resolved — while loading/errored/disabled, the shell keeps
  // whatever accent is already cascading (the base DS tokens) rather than a
  // partial or stale override.
  const { status, context } = usePortalContext()

  return (
    <PortalThemeScope context={status === 'ready' ? context : null}>
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
    </PortalThemeScope>
  )
}

export default Layout
