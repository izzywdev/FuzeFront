import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './lib/shared'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './contexts/LanguageContext'
import App from './App.tsx'
import './index.css'

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
