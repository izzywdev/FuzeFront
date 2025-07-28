import React, { useState, useEffect } from 'react'
import { useHealthCheck, useNewsletter, useContactForm, useAnalytics, useAutoPageTracking } from './hooks/useApi'

function App() {
  // API hooks
  const { data: healthData, loading: healthLoading, error: healthError } = useHealthCheck()
  const { subscribe, loading: newsletterLoading, success: newsletterSuccess, error: newsletterError } = useNewsletter()
  const { submitForm, loading: contactLoading, success: contactSuccess, error: contactError } = useContactForm()
  const { trackEvent } = useAnalytics()
  
  // Auto track page views
  useAutoPageTracking()

  // Form states
  const [email, setEmail] = useState('')
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  })

  // Track app load event
  useEffect(() => {
    trackEvent({
      event: 'app_loaded',
      properties: { timestamp: new Date().toISOString() }
    }).catch(console.error)
  }, [trackEvent])

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    try {
      await subscribe({ email: email.trim() })
      setEmail('')
      trackEvent({ event: 'newsletter_subscribe', properties: { email } })
    } catch (error) {
      console.error('Newsletter subscription failed:', error)
    }
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!contactForm.name || !contactForm.email || !contactForm.subject || !contactForm.message) return

    try {
      await submitForm(contactForm)
      setContactForm({ name: '', email: '', subject: '', message: '' })
      trackEvent({ event: 'contact_form_submit', properties: { subject: contactForm.subject } })
    } catch (error) {
      console.error('Contact form submission failed:', error)  
    }
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f0f0f0', 
      padding: '40px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ 
        fontSize: '48px', 
        color: '#333', 
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        🚀 FuzeFront Website v2.0
      </h1>
      <p style={{ 
        fontSize: '24px', 
        color: '#666',
        textAlign: 'center',
        marginBottom: '30px'
      }}>
        React app with live API integration - Deployed via CI/CD
      </p>

      {/* API Health Status */}
      <div style={{ 
        backgroundColor: healthError ? '#f44336' : '#4CAF50', 
        color: 'white', 
        padding: '20px',
        borderRadius: '8px',
        textAlign: 'center',
        maxWidth: '600px',
        margin: '0 auto 30px'
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>
          {healthLoading ? '⏳ Connecting...' : healthError ? '❌ API Offline' : '✅ API Connected'}
        </h2>
        {healthData && (
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            <p>Status: {healthData.status}</p>
            <p>Environment: {healthData.environment}</p>
            <p>Version: {healthData.version}</p>
            <p>Last Check: {new Date(healthData.timestamp).toLocaleTimeString()}</p>
          </div>
        )}
        {healthError && (
          <p style={{ margin: '10px 0 0 0', fontSize: '14px' }}>
            Backend API is not responding. Please check that the backend service is running.
          </p>
        )}
      </div>

      {/* Newsletter Subscription */}
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        maxWidth: '600px',
        margin: '0 auto 30px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>📧 Subscribe to Newsletter</h3>
        {newsletterSuccess ? (
          <div style={{ color: '#4CAF50', fontWeight: 'bold' }}>
            ✅ Successfully subscribed to newsletter!
          </div>
        ) : (
          <form onSubmit={handleNewsletterSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                flex: '1',
                minWidth: '200px',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px'
              }}
              required
            />
            <button
              type="submit"
              disabled={newsletterLoading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: newsletterLoading ? 'not-allowed' : 'pointer',
                fontSize: '16px'
              }}
            >
              {newsletterLoading ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>
        )}
        {newsletterError && (
          <div style={{ color: '#f44336', marginTop: '10px', fontSize: '14px' }}>
            ❌ {newsletterError}
          </div>
        )}
      </div>

      {/* Contact Form */}
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        maxWidth: '600px',
        margin: '0 auto 30px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>💬 Contact Us</h3>
        {contactSuccess ? (
          <div style={{ color: '#4CAF50', fontWeight: 'bold' }}>
            ✅ Message sent successfully! We'll get back to you soon.
          </div>
        ) : (
          <form onSubmit={handleContactSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Your Name"
                value={contactForm.name}
                onChange={(e) => setContactForm({...contactForm, name: e.target.value})}
                style={{
                  flex: '1',
                  minWidth: '200px',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '16px'
                }}
                required
              />
              <input
                type="email"
                placeholder="Your Email"
                value={contactForm.email}
                onChange={(e) => setContactForm({...contactForm, email: e.target.value})}
                style={{
                  flex: '1',
                  minWidth: '200px',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '16px'
                }}
                required
              />
            </div>
            <input
              type="text"
              placeholder="Subject"
              value={contactForm.subject}
              onChange={(e) => setContactForm({...contactForm, subject: e.target.value})}
              style={{
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px'
              }}
              required
            />
            <textarea
              placeholder="Your Message"
              value={contactForm.message}
              onChange={(e) => setContactForm({...contactForm, message: e.target.value})}
              rows={4}
              style={{
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                resize: 'vertical'
              }}
              required
            />
            <button
              type="submit"
              disabled={contactLoading}
              style={{
                padding: '12px 24px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: contactLoading ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold'
              }}
            >
              {contactLoading ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
        {contactError && (
          <div style={{ color: '#f44336', marginTop: '10px', fontSize: '14px' }}>
            ❌ {contactError}
          </div>
        )}
      </div>

      {/* System Info */}
      <div style={{ 
        marginTop: '30px',
        textAlign: 'center',
        fontSize: '14px',
        color: '#888',
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        maxWidth: '600px',
        margin: '30px auto 0'
      }}>
        <p>🕒 Current Time: {new Date().toLocaleString()}</p>
        <p>⚛️ React Version: {React.version}</p>
        <p>🌐 Page: {window.location.pathname}</p>
        <p>🔄 Last Updated: {new Date().toISOString()}</p>
      </div>
    </div>
  )
}

export default App
