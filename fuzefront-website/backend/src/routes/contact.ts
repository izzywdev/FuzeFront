import express from 'express'
import { body, validationResult } from 'express-validator'
import nodemailer from 'nodemailer'
import { z } from 'zod'

const router = express.Router()

// Contact form validation schema
const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  email: z.string().email('Invalid email address'),
  company: z.string().max(100, 'Company name too long').optional(),
  subject: z.string().min(5, 'Subject must be at least 5 characters').max(200, 'Subject too long'),
  message: z.string().min(10, 'Message must be at least 10 characters').max(2000, 'Message too long'),
  phone: z.string().max(20, 'Phone number too long').optional(),
  interest: z.enum(['platform', 'infrastructure', 'consultation', 'partnership', 'other']).optional(),
})

// Configure nodemailer transporter
const createTransporter = () => {
  if (process.env.NODE_ENV === 'production') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  } else {
    // Development mode - log to console
    return nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    } as any)
  }
}

// Contact form submission
router.post('/submit', [
  body('name').trim().isLength({ min: 2, max: 100 }).escape(),
  body('email').isEmail().normalizeEmail(),
  body('company').optional().trim().isLength({ max: 100 }).escape(),
  body('subject').trim().isLength({ min: 5, max: 200 }).escape(),
  body('message').trim().isLength({ min: 10, max: 2000 }).escape(),
  body('phone').optional().trim().isLength({ max: 20 }).escape(),
  body('interest').optional().isIn(['platform', 'infrastructure', 'consultation', 'partnership', 'other']),
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
    const validatedData = contactSchema.parse(req.body)

    // Create email content
    const emailContent = `
New Contact Form Submission - FuzeFront.com

Name: ${validatedData.name}
Email: ${validatedData.email}
Company: ${validatedData.company || 'Not provided'}
Phone: ${validatedData.phone || 'Not provided'}
Interest: ${validatedData.interest || 'Not specified'}

Subject: ${validatedData.subject}

Message:
${validatedData.message}

---
Submitted at: ${new Date().toISOString()}
IP Address: ${req.ip}
User Agent: ${req.get('User-Agent')}
`

    // Send email
    const transporter = createTransporter()
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
      to: process.env.EMAIL_TO || 'contact@fuzefront.com',
      subject: `[FuzeFront Contact] ${validatedData.subject}`,
      text: emailContent,
      replyTo: validatedData.email,
    }

    if (process.env.NODE_ENV === 'production') {
      await transporter.sendMail(mailOptions)
    } else {
      console.log('📧 Contact form submission (development mode):')
      console.log(emailContent)
    }

    // Send auto-reply to user
    const autoReplyOptions = {
      from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
      to: validatedData.email,
      subject: 'Thank you for contacting FuzeFront',
      text: `Hi ${validatedData.name},

Thank you for reaching out to FuzeFront! We've received your message and will get back to you within 24 hours.

Your message:
Subject: ${validatedData.subject}
${validatedData.message}

Best regards,
The FuzeFront Team

---
This is an automated response. Please don't reply to this email.
For urgent matters, please contact us at contact@fuzefront.com
`,
    }

    if (process.env.NODE_ENV === 'production') {
      await transporter.sendMail(autoReplyOptions)
    }

    res.json({
      success: true,
      message: 'Thank you for your message! We\'ll get back to you soon.',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Contact form error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
    }

    res.status(500).json({
      error: 'Failed to send message',
      message: 'Please try again later or contact us directly.'
    })
  }
})

export { router as contactRoutes }