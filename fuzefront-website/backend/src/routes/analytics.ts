import express from 'express'
import { body, validationResult } from 'express-validator'
import { z } from 'zod'

const router = express.Router()

// Analytics event validation schema
const analyticsSchema = z.object({
  event: z.string().min(1, 'Event name required'),
  page: z.string().min(1, 'Page required'),
  timestamp: z.string().datetime().optional(),
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
  sessionId: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
})

// In-memory store for development (replace with database/analytics service in production)
const events: Array<{
  event: string
  page: string
  timestamp: string
  userAgent?: string
  referrer?: string
  sessionId?: string
  ip: string
  properties?: Record<string, unknown>
}> = []

// Track page view
router.post('/page-view', [
  body('page').trim().isLength({ min: 1 }),
  body('referrer').optional().trim(),
  body('sessionId').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    const eventData = {
      event: 'page_view',
      page: req.body.page,
      timestamp: new Date().toISOString(),
      userAgent: req.get('User-Agent'),
      referrer: req.body.referrer || req.get('Referrer'),
      sessionId: req.body.sessionId,
      ip: req.ip,
      properties: req.body.properties
    }

    events.push(eventData)

    console.log('📊 Page view:', eventData)

    res.json({ success: true })

  } catch (error) {
    console.error('Analytics page view error:', error)
    res.status(500).json({ error: 'Failed to track page view' })
  }
})

// Track custom event
router.post('/event', [
  body('event').trim().isLength({ min: 1 }),
  body('page').trim().isLength({ min: 1 }),
  body('properties').optional().isObject(),
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    const validatedData = analyticsSchema.parse({
      ...req.body,
      timestamp: req.body.timestamp || new Date().toISOString()
    })

    const eventData = {
      event: validatedData.event,
      page: validatedData.page,
      timestamp: validatedData.timestamp || new Date().toISOString(),
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referrer'),
      sessionId: validatedData.sessionId,
      ip: req.ip,
      properties: validatedData.properties,
    }

    events.push(eventData)

    console.log('📊 Custom event:', eventData)

    res.json({ success: true })

  } catch (error) {
    console.error('Analytics event error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
    }

    res.status(500).json({ error: 'Failed to track event' })
  }
})

// Get analytics summary (for admin use)
router.get('/summary', (req, res) => {
  // In production, add authentication middleware
  const summary = {
    totalEvents: events.length,
    pageViews: events.filter(e => e.event === 'page_view').length,
    customEvents: events.filter(e => e.event !== 'page_view').length,
    uniquePages: [...new Set(events.map(e => e.page))].length,
    recentEvents: events.slice(-10).reverse(),
    timestamp: new Date().toISOString()
  }

  res.json(summary)
})

// Health check for analytics service
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'analytics',
    timestamp: new Date().toISOString()
  })
})

// Get page analytics
router.get('/pages', (req, res) => {
  // In production, add authentication middleware
  const pageViews = events.filter(e => e.event === 'page_view')
  const pageStats = pageViews.reduce((acc, event) => {
    acc[event.page] = (acc[event.page] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const sortedPages = Object.entries(pageStats)
    .sort(([, a], [, b]) => b - a)
    .map(([page, views]) => ({ page, views }))

  res.json({
    pages: sortedPages,
    totalPageViews: pageViews.length,
    timestamp: new Date().toISOString()
  })
})

export { router as analyticsRoutes }