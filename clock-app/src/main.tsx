import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerWithHub } from './sdk'

// When opened STANDALONE (not mounted by the host), self-register with the hub
// so it appears in the launcher. The hub URL and this app's public URL come from
// build-time env (configuration) — never from importing host code.
const HUB_API_URL = import.meta.env.VITE_HUB_API_URL || 'http://fuzefront.dev.local'
const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || 'http://clock.dev.local'

if (!(window as any).__FRONTFUSE_PLATFORM__) {
  void registerWithHub({
    hubApiUrl: HUB_API_URL,
    name: 'FuzeClock',
    url: PUBLIC_URL,
    remoteUrl: PUBLIC_URL,
    scope: 'fuzeClock',
    module: './App',
    iconUrl: `${PUBLIC_URL}/clock-icon.svg`,
    description:
      'Example on-the-fly microfrontend: a live clock loaded at runtime.',
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
