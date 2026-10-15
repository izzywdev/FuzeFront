import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { StandaloneAuthBoundary } from './standaloneAuth'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <StandaloneAuthBoundary>
        {(session, signOut) => (
          <App
            getToken={() => session.token}
            getTenantId={() => session.tenantId}
            onSignOut={signOut}
          />
        )}
      </StandaloneAuthBoundary>
    </BrowserRouter>
  </React.StrictMode>
)
