import express from 'express'
import { body, validationResult } from 'express-validator'
import { z } from 'zod'

const router = express.Router()

// Newsletter subscription validation schema
const newsletterSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long').optional(),
  interests: z.array(z.enum(['platform', 'infrastructure', 'updates', 'blog', 'events'])).optional(),
})

// In-memory store for development (replace with database in production)
const subscribers = new Set<string>()

// Subscribe to newsletter
router.post('/subscribe', [
  body('email').isEmail().normalizeEmail(),
  body('name').optional().trim().isLength({ min: 2, max: 100 }).escape(),
  body('interests').optional().isArray(),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    // Validate with Zod
    const validatedData = newsletterSchema.parse(req.body)

    // Check if already subscribed
    if (subscribers.has(validatedData.email)) {
      return res.json({
        success: true,
        message: 'You are already subscribed to our newsletter!',
        alreadySubscribed: true
      })
    }

    // Add to subscribers (in production, save to database)
    subscribers.add(validatedData.email)

    console.log('📧 Newsletter subscription:', {
      email: validatedData.email,
      name: validatedData.name,
      interests: validatedData.interests,
      timestamp: new Date().toISOString()
    })

    // In production, you would:
    // 1. Save to database
    // 2. Send confirmation email
    // 3. Add to email marketing platform (Mailchimp, SendGrid, etc.)
    
    res.json({
      success: true,
      message: 'Thank you for subscribing to our newsletter!',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Newsletter subscription error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
    }

    res.status(500).json({
      error: 'Failed to subscribe',
      message: 'Please try again later.'
    })
  }
})

// Unsubscribe from newsletter
router.post('/unsubscribe', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    const { email } = req.body

    // Remove from subscribers
    subscribers.delete(email)

    console.log('📧 Newsletter unsubscribe:', {
      email,
      timestamp: new Date().toISOString()
    })

    res.json({
      success: true,
      message: 'You have been unsubscribed from our newsletter.',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Newsletter unsubscribe error:', error)
    
    res.status(500).json({
      error: 'Failed to unsubscribe',
      message: 'Please try again later.'
    })
  }
})

// Get newsletter stats (for admin use)
router.get('/stats', (req, res) => {
  // In production, add authentication middleware
  res.json({
    totalSubscribers: subscribers.size,
    timestamp: new Date().toISOString()
  })
})

export { router as newsletterRoutes }