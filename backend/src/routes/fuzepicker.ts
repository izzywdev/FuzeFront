import crypto from 'crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { defaultEventPublisher } from '../services/eventPublisher'

const router = express.Router()

const mentionsRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many FuzePicker requests. Try again shortly.' },
})

const emailSchema = z.string().trim().toLowerCase().email().max(320)
const createMentionSchema = z.object({
  recipientEmail: emailSchema,
  message: z.string().trim().min(1).max(4_000),
  pageUrl: z.string().url().max(8_000).refine(value => /^https?:\/\//i.test(value), 'Only http(s) page URLs are allowed'),
  componentXPath: z.string().trim().min(1).max(8_000),
})
const replySchema = z.object({ message: z.string().trim().min(1).max(4_000) })

function senderName(user: { firstName?: string; lastName?: string; email: string }) {
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
}

/** Create a mention from the extension after the user selects a component. */
router.post('/mentions', mentionsRateLimiter, authenticateToken, async (req: any, res) => {
  const parsed = createMentionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid mention', details: ('error' in parsed ? parsed.error.flatten() : undefined) })

  const mentionId = crypto.randomUUID()
  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
  const mention = {
    id: mentionId,
    sender_id: req.user.id,
    recipient_email: parsed.data.recipientEmail,
    message: parsed.data.message,
    page_url: parsed.data.pageUrl,
    component_xpath: parsed.data.componentXPath,
    status: 'unread',
    invite_token: inviteToken,
    invite_expires_at: expiresAt,
  }

  try {
    await db('fuzepicker_mentions').insert(mention)
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const mentionUrl = `${appUrl}/fuzepicker/mentions?invite=${encodeURIComponent(inviteToken)}`

    // Delivery is intentionally non-blocking, matching organization invites:
    // the collaboration record remains available if the mail provider retries.
    try {
      await defaultEventPublisher.publishNotifyEmailRequested({
        to: mention.recipient_email,
        template: 'fuzepicker-mention',
        vars: { senderName: senderName(req.user), message: mention.message, mentionUrl },
        correlationId: mentionId,
      }, mentionId)
    } catch (emailError) {
      console.error('Failed to publish FuzePicker mention email (non-fatal):', emailError)
    }

    return res.status(201).json({
      mention: {
        id: mentionId,
        recipientEmail: mention.recipient_email,
        message: mention.message,
        pageUrl: mention.page_url,
        componentXPath: mention.component_xpath,
        status: mention.status,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to create FuzePicker mention:', error)
    return res.status(500).json({ error: 'Failed to create mention' })
  }
})

/** Lists only the current verified email's mentions; no user-directory lookup is needed. */
router.get('/mentions', mentionsRateLimiter, authenticateToken, async (req: any, res) => {
  try {
    const rows = await db('fuzepicker_mentions as mention')
      .leftJoin('users as sender', 'sender.id', 'mention.sender_id')
      .select(
        'mention.id', 'mention.message', 'mention.page_url', 'mention.component_xpath',
        'mention.status', 'mention.created_at', 'mention.invite_expires_at',
        'sender.email as sender_email', 'sender.first_name as sender_first_name', 'sender.last_name as sender_last_name',
      )
      .where('mention.recipient_email', String(req.user.email).toLowerCase())
      .orderBy('mention.created_at', 'desc')

    return res.json({ mentions: rows.map(row => ({
      id: row.id,
      sender: `${row.sender_first_name || ''} ${row.sender_last_name || ''}`.trim() || row.sender_email,
      message: row.message,
      pageUrl: row.page_url,
      componentXPath: row.component_xpath,
      status: row.status,
      createdAt: row.created_at,
      inviteExpiresAt: row.invite_expires_at,
    })) })
  } catch (error) {
    console.error('Failed to list FuzePicker mentions:', error)
    return res.status(500).json({ error: 'Failed to load mentions' })
  }
})

router.post('/mentions/:mentionId/read', mentionsRateLimiter, authenticateToken, async (req: any, res) => {
  const updated = await db('fuzepicker_mentions')
    .where({ id: req.params.mentionId, recipient_email: String(req.user.email).toLowerCase() })
    .update({ status: 'read', updated_at: new Date() })
  if (!updated) return res.status(404).json({ error: 'Mention not found' })
  return res.status(204).end()
})

router.post('/mentions/:mentionId/replies', mentionsRateLimiter, authenticateToken, async (req: any, res) => {
  const parsed = replySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reply', details: ('error' in parsed ? parsed.error.flatten() : undefined) })
  const mention = await db('fuzepicker_mentions')
    .where({ id: req.params.mentionId, recipient_email: String(req.user.email).toLowerCase() })
    .first()
  if (!mention) return res.status(404).json({ error: 'Mention not found' })

  const replyId = crypto.randomUUID()
  await db('fuzepicker_mention_replies').insert({ id: replyId, mention_id: mention.id, author_id: req.user.id, message: parsed.data.message })
  try {
    const sender = await db('users').select('email').where('id', mention.sender_id).first()
    if (sender?.email) {
      const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
      await defaultEventPublisher.publishNotifyEmailRequested({
        to: sender.email,
        template: 'fuzepicker-reply',
        vars: { recipientName: senderName(req.user), message: parsed.data.message, mentionsUrl: `${appUrl}/fuzepicker/mentions` },
        correlationId: replyId,
      }, replyId)
    }
  } catch (emailError) {
    console.error('Failed to publish FuzePicker reply email (non-fatal):', emailError)
  }
  return res.status(201).json({ reply: { id: replyId, mentionId: mention.id, message: parsed.data.message } })
})

export default router
