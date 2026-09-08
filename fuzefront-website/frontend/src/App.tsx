import React from 'react'
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
import { CareersPage } from './pages/CareersPage'
import { PressPage } from './pages/PressPage'
import { NotFoundPage } from './pages/NotFoundPage'
// Design tokens ONLY (colors/fonts/typography/spacing) from the shared
// @fuzefront/design-system — the single source of truth for the family's
// palette, so Header/Footer render with the real brand colors instead of a
// site-local, drifted-from-the-DS Tailwind palette. Deliberately NOT
// design-system/tokens/base.css: it sets element-level `body`/`h1`-`h3`
// rules (background/color/font-size) tuned for the app shell's own layout,
// which would fight this marketing site's very different page structure.
import '@fuzefront/design-system/tokens/colors.css'
import '@fuzefront/design-system/tokens/fonts.css'
import '@fuzefront/design-system/tokens/typography.css'
import '@fuzefront/design-system/tokens/spacing.css'
import './App.css'

function AppLayout() {
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
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/press" element={<PressPage />} />
          <Route path="*" element={<NotFoundPage />} />
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
          <AppLayout />
        </NotificationProvider>
      </AnalyticsProvider>
    </BrowserRouter>
  )
}

export default App
