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
  // Simple test version to debug blank page issue
  try {
    return (
      <div className="min-h-screen bg-white p-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          FuzeFront Website - Test Mode
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          If you can see this text, React is working correctly.
        </p>
        <div className="bg-blue-100 p-4 rounded-lg">
          <p className="text-blue-800">
            Debug info: React app is mounting and CSS classes are working.
          </p>
        </div>
        <AnalyticsProvider>
          <NotificationProvider>
            <Router>
              <div className="mt-8">
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
      </div>
    )
  } catch (error) {
    return (
      <div className="min-h-screen bg-red-50 p-8">
        <h1 className="text-4xl font-bold text-red-900 mb-4">
          React Error Detected
        </h1>
        <p className="text-xl text-red-600">
          Error: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }
}

export default App
