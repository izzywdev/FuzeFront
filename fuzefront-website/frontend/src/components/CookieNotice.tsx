import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Cookie } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

export const CookieNotice: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false)
  const { trackEvent } = useAnalytics()

  useEffect(() => {
    const cookieConsent = localStorage.getItem('cookie-consent')
    if (!cookieConsent) {
      // Show cookie notice after a short delay
      const timer = setTimeout(() => {
        setIsVisible(true)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleAccept = () => {
    localStorage.setItem('cookie-consent', 'accepted')
    setIsVisible(false)
    trackEvent('cookie_consent', { action: 'accepted' })
  }

  const handleDecline = () => {
    localStorage.setItem('cookie-consent', 'declined')
    setIsVisible(false)
    trackEvent('cookie_consent', { action: 'declined' })
  }

  const handleCustomize = () => {
    // In a real app, this would open a cookie preferences modal
    trackEvent('cookie_consent', { action: 'customize' })
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto"
        >
          <div className="bg-white rounded-lg shadow-hard border border-gray-200 p-6">
            <div className="flex items-start space-x-3">
              <Cookie className="text-primary-600 flex-shrink-0 mt-1" size={24} />
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-2">
                  We use cookies
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  We use cookies to enhance your experience, analyze site traffic, and for marketing purposes. 
                  By continuing to use our site, you agree to our use of cookies.
                </p>
                
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <button
                    onClick={handleAccept}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    Accept All
                  </button>
                  <button
                    onClick={handleDecline}
                    className="btn-secondary text-sm px-4 py-2"
                  >
                    Decline
                  </button>
                  <button
                    onClick={handleCustomize}
                    className="text-sm text-gray-600 hover:text-primary-600 transition-colors underline"
                  >
                    Customize
                  </button>
                </div>
                
                <p className="text-xs text-gray-500 mt-2">
                  Learn more in our{' '}
                  <a href="/privacy" className="text-primary-600 hover:text-primary-700">
                    Privacy Policy
                  </a>
                  {' '}and{' '}
                  <a href="/cookies" className="text-primary-600 hover:text-primary-700">
                    Cookie Policy
                  </a>
                </p>
              </div>
              
              <button
                onClick={() => setIsVisible(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}