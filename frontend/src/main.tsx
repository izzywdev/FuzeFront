import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './lib/shared'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './contexts/LanguageContext'
import App from './App.tsx'
import './index.css'

// Enhanced console logging for debugging
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
}

// Store logs for debugging
const logHistory: any[] = []

// Enhanced console with timestamps and storage
const enhanceConsole = () => {
  const timestamp = () => `[${new Date().toISOString()}]`

  console.log = (...args) => {
    const entry = { type: 'log', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.log(timestamp(), ...args)
  }

  console.error = (...args) => {
    const entry = { type: 'error', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.error(timestamp(), ...args)
  }

  console.warn = (...args) => {
    const entry = { type: 'warn', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.warn(timestamp(), ...args)
  }

  console.info = (...args) => {
    const entry = { type: 'info', timestamp: new Date().toISOString(), args }
    logHistory.push(entry)
    originalConsole.info(timestamp(), ...args)
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
      <LanguageProvider>
        <ThemeProvider>
          <AppProvider>
            <App />
          </AppProvider>
        </ThemeProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
)
