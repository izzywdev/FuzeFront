import React from 'react'
import TopBar from './TopBar'
import SidePanel from './SidePanel'

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
    </div>
  )
}

export default Layout
