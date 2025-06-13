import React, { useState } from 'react'
import { useCurrentUser } from '../lib/shared'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useChat } from '../contexts/ChatContext'
import AppSelector from './AppSelector'
import UserMenu from './UserMenu'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

function TopBar() {
  const { user } = useCurrentUser()
  const { theme, toggleTheme } = useTheme()
  const { language, setLanguage, t } = useLanguage()
  const { state: chatState, toggleChat } = useChat()
  const [isLanguageOpen, setIsLanguageOpen] = useState(false)

  return (
    <div className="top-bar">
      <div className="logo">
        <img
          src={FrontFuseLogo}
          alt="FrontFuse"
          style={{
            height: '32px',
            width: 'auto',
            marginRight: '8px',
          }}
        />
        <h2>{t('frontFuse')}</h2>
      </div>
      <div style={{ flex: 1 }}></div> {/* Spacer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <AppSelector />

        {/* Language Selector */}
        <div style={{ position: 'relative' }}>
          <button
            className="theme-toggle"
            onClick={() => setIsLanguageOpen(!isLanguageOpen)}
            title="Change Language"
          >
            🌐
          </button>

          {isLanguageOpen && (
            <>
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'transparent',
                  zIndex: 999,
                }}
                onClick={() => setIsLanguageOpen(false)}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: '0',
                  marginTop: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '8px',
                  minWidth: '120px',
                  zIndex: 1000,
                  boxShadow: '0 8px 32px var(--shadow)',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor:
                      language === 'en' ? 'var(--accent-color)' : 'transparent',
                    transition: 'background-color 0.2s ease',
                  }}
                  onClick={() => {
                    setLanguage('en')
                    setIsLanguageOpen(false)
                  }}
                  onMouseEnter={e => {
                    if (language !== 'en') {
                      e.currentTarget.style.backgroundColor =
                        'var(--bg-quaternary)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (language !== 'en') {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  🇺🇸 English
                </div>

                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor:
                      language === 'he' ? 'var(--accent-color)' : 'transparent',
                    transition: 'background-color 0.2s ease',
                  }}
                  onClick={() => {
                    setLanguage('he')
                    setIsLanguageOpen(false)
                  }}
                  onMouseEnter={e => {
                    if (language !== 'he') {
                      e.currentTarget.style.backgroundColor =
                        'var(--bg-quaternary)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (language !== 'he') {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  🇮🇱 עברית
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chat Toggle */}
        <button
          className={`theme-toggle ${chatState.isOpen ? 'active' : ''}`}
          onClick={toggleChat}
          title={chatState.isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          style={{
            backgroundColor: chatState.isOpen
              ? 'var(--accent-color)'
              : 'transparent',
            color: chatState.isOpen ? 'white' : 'var(--text-primary)',
          }}
        >
          🤖
        </button>

        {/* Theme Toggle */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={t(theme === 'dark' ? 'switchToLight' : 'switchToDark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <UserMenu user={user} />
      </div>
    </div>
  )
}

export default TopBar
