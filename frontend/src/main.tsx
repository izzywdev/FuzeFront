import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { I18nProvider } from '@fuzefront/i18n'
import { AppProvider } from './lib/shared'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { resources } from './i18n/resources'
import { migrateLegacySession } from './lib/accounts'
import App from './App.tsx'
// Design-system token scales (spacing / type / radii / motion) the DS
// components — e.g. the <Select> rendered by @fuzefront/i18n's
// LanguageSelector — depend on. Imported before index.css so the host's own
// color theme (defined there) still wins where the two overlap.
import '@fuzefront/design-system/styles.css'
import '@fuzefront/auth-ui/styles.css'
import './index.css'
import { registerServiceWorker } from './registerServiceWorker'

// Enhanced console logging for debugging
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
}

// Store logs for debugging
const logHistory: any[] = []

// Log-injection defense for the patched console (CodeQL js/log-injection).
//
// Everything this shell logs funnels through the four wrappers below, and a
// lot of it is caller-influenced — `navigator.userAgent`, `location.href`,
// and the `message`/`filename` of a window `error` event all reach a console
// call. A string carrying CR/LF can forge an entirely separate log entry in
// whatever later reads these lines; a string in leading position could also be
// read as a format string.
//
// Two rules, applied here once instead of at every call site:
//  1. The FIRST argument handed to the original console is always the constant
//     timestamp — never a caller-supplied value — so no value can act as the
//     format string.
//  2. Every string argument has its line terminators escaped. The information
//     is preserved verbatim (an escaped `\n` is still readable); it just can no
//     longer break the line. Non-strings pass through untouched so objects and
//     Errors stay structurally inspectable in devtools (and are rendered as a
//     tree, not as raw text, so they cannot forge a line either).
// Chained single-character replaces (not a `[\r\n\u2026]` character class): CodeQL's
// js/log-injection only recognises a replace() whose matched string is constant
// as a sanitiser barrier, so a class-based strip cleans the value but is not
// seen as a barrier and the alert stays open.
const sanitizeLogArg = (arg: unknown): unknown =>
  typeof arg === 'string'
    ? arg
        .replace(/\r/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\n')
        .replace(/\u2029/g, '\\n')
    : arg

// Enhanced console with timestamps and storage
const enhanceConsole = () => {
  const timestamp = () => `[${new Date().toISOString()}]`

  console.log = (...args) => {
    const entry = { type: 'log', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.log(timestamp(), ...args.map(sanitizeLogArg))
  }

  console.error = (...args) => {
    const entry = { type: 'error', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.error(timestamp(), ...args.map(sanitizeLogArg))
  }

  console.warn = (...args) => {
    const entry = { type: 'warn', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.warn(timestamp(), ...args.map(sanitizeLogArg))
  }

  console.info = (...args) => {
    const entry = { type: 'info', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.info(timestamp(), ...args.map(sanitizeLogArg))
  }
}

// Global error handlers
window.addEventListener('error', event => {
  console.error('🚨 Global Error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    stack: event.error?.stack,
  })
})

window.addEventListener('unhandledrejection', event => {
  console.error('🚨 Unhandled Promise Rejection:', {
    reason: event.reason,
    promise: event.promise,
    stack: event.reason?.stack,
  })
})

// Make log history available globally for debugging
;(window as any).getLogHistory = () => logHistory
;(window as any).clearLogHistory = () => (logHistory.length = 0)
;(window as any).exportLogs = () => {
  const logs = JSON.stringify(logHistory, null, 2)
  const blob = new Blob([logs], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `frontend-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// Initialize enhanced console
enhanceConsole()

// Move any pre-multi-account session into the account vault BEFORE anything
// reads a token. Running this after the first API call would let a bare
// `authToken` be read once by code paths the vault is meant to own — see
// lib/accounts.ts, rule 1 of the isolation model.
migrateLegacySession()

// Keep the PWA service worker checking for updates while the tab is open —
// see registerServiceWorker.ts for why this is required (autoUpdate alone
// only re-checks on hard navigation / the browser's ~24h heuristic).
registerServiceWorker()

console.log('🚀 Frontend Application Starting:', {
  timestamp: new Date().toISOString(),
  userAgent: navigator.userAgent,
  url: window.location.href,
  environment: {
    NODE_ENV: import.meta.env.NODE_ENV,
    MODE: import.meta.env.MODE,
    VITE_API_URL: import.meta.env.VITE_API_URL,
    BASE_URL: import.meta.env.BASE_URL,
    DEV: import.meta.env.DEV,
    PROD: import.meta.env.PROD,
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Shared i18n runtime: owns the single i18next instance + the centralized
          <html dir/lang> direction manager. Bundled locale JSON is inlined from
          the repo-root `locales/` tree. The legacy LanguageProvider stays mounted
          for not-yet-migrated useLanguage() consumers during incremental rollout. */}
      <I18nProvider resources={resources}>
        <LanguageProvider>
          <ThemeProvider>
            <AppProvider>
              <App />
            </AppProvider>
          </ThemeProvider>
        </LanguageProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
)
