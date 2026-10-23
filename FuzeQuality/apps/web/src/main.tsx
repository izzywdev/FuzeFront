import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import {
  developmentAuthBypassEnabled,
  portalTokenProvider,
  StandaloneAuthBoundary,
} from './standaloneAuth'
import './styles.css'

const hostToken = portalTokenProvider()
const developmentAuthBypass = developmentAuthBypassEnabled(
  import.meta.env.DEV,
  import.meta.env.FUZEQUALITY_DEV_AUTH_BYPASS,
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {hostToken ? <App getToken={hostToken} /> : developmentAuthBypass ? <App /> : (
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
