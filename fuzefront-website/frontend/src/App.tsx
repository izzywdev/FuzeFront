import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AnalyticsProvider } from './contexts/AnalyticsContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { CookieNotice } from './components/CookieNotice'
import { HomePage } from './pages/HomePage'
import { ProductsPage } from './pages/ProductsPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { PricingPage } from './pages/PricingPage'
import { AboutPage } from './pages/AboutPage'
import { BlogPage } from './pages/BlogPage'
import { ContactPage } from './pages/ContactPage'
import { SolutionsPage } from './pages/SolutionsPage'
import { IndustriesPage } from './pages/IndustriesPage'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { TermsPage } from './pages/TermsPage'
import { FuzeHubPage } from './pages/FuzeHubPage'
import { useAnalytics, useAutoPageTracking } from './hooks/useApi'
import './App.css'

const IS_DEVELOPMENT = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development'

function AppContent() {
  const { trackEvent } = useAnalytics()
  useAutoPageTracking()

  useEffect(() => {
    const hasTrackedAppLoad = sessionStorage.getItem('app_loaded')
    if (!hasTrackedAppLoad) {
      trackEvent({
        event: 'app_loaded',
        properties: { timestamp: new Date().toISOString() }
      }).catch((err: unknown) => IS_DEVELOPMENT && console.error(err))
      sessionStorage.setItem('app_loaded', 'true')
    }
  }, [trackEvent])

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:productSlug" element={<ProductDetailPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/industries" element={<IndustriesPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/fuzehub" element={<FuzeHubPage />} />
          {/* Fallback to home */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>
      <Footer />
      <CookieNotice />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AnalyticsProvider>
        <NotificationProvider>
          <AppContent />
        </NotificationProvider>
      </AnalyticsProvider>
    </BrowserRouter>
  )
}

export default App
