import React, { createContext, useContext, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'

interface AnalyticsContextType {
  trackEvent: (event: string, properties?: Record<string, unknown>) => void
  trackPageView: (page: string, referrer?: string) => void
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined)

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation()

  // Generate a session ID for tracking
  const sessionId = React.useMemo(() => {
    const stored = sessionStorage.getItem('analytics_session_id')
    if (stored) return stored
    
    const newId = crypto.randomUUID()
    sessionStorage.setItem('analytics_session_id', newId)
    return newId
  }, [])

  const trackEvent = useCallback(async (event: string, properties?: Record<string, unknown>) => {
    try {
      await axios.post(`${API_BASE_URL}/api/analytics/event`, {
        event,
        page: location.pathname,
        sessionId,
        properties
      })
    } catch (error) {
      console.error('Analytics tracking error:', error)
    }
  }, [location.pathname, sessionId])

  const trackPageView = useCallback(async (page: string, referrer?: string) => {
    try {
      await axios.post(`${API_BASE_URL}/api/analytics/page-view`, {
        page,
        sessionId,
        referrer
      })
    } catch (error) {
      console.error('Page view tracking error:', error)
    }
  }, [sessionId])

  // Track page views automatically
  useEffect(() => {
    trackPageView(location.pathname, document.referrer)
  }, [location.pathname, trackPageView])

  const value: AnalyticsContextType = {
    trackEvent,
    trackPageView
  }

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  )
}

export const useAnalytics = (): AnalyticsContextType => {
  const context = useContext(AnalyticsContext)
  if (!context) {
    throw new Error('useAnalytics must be used within an AnalyticsProvider')
  }
  return context
}