import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { portalTokenProvider, StandaloneAuthBoundary } from './standaloneAuth'
import './styles.css'

const hostToken = portalTokenProvider()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {hostToken ? <App getToken={hostToken} /> : (
        <StandaloneAuthBoundary>
          {(session, signOut) => (
            <App
              getToken={() => session.token}
              getTenantId={() => session.tenantId}
              onSignOut={signOut}
            />
          )}
        </StandaloneAuthBoundary>
      )}
    </BrowserRouter>
  </React.StrictMode>
)
