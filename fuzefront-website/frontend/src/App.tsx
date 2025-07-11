import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { HomePage } from './pages/HomePage'
import { ProductsPage } from './pages/ProductsPage'
import { SolutionsPage } from './pages/SolutionsPage'
import { PricingPage } from './pages/PricingPage'
import { AboutPage } from './pages/AboutPage'
import { ContactPage } from './pages/ContactPage'
import { BlogPage } from './pages/BlogPage'
import { CookieNotice } from './components/CookieNotice'
import { AnalyticsProvider } from './contexts/AnalyticsContext'
import { NotificationProvider } from './contexts/NotificationContext'
import './App.css'

function App() {
  return (
    <AnalyticsProvider>
      <NotificationProvider>
        <Router>
          <div className="min-h-screen bg-white">
            <Header />
            <AnimatePresence mode="wait">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/solutions" element={<SolutionsPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/blog" element={<BlogPage />} />
              </Routes>
            </AnimatePresence>
            <Footer />
            <CookieNotice />
          </div>
        </Router>
      </NotificationProvider>
    </AnalyticsProvider>
  )
}

export default App
