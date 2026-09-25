import express, { Request, Response } from 'express'
import axios, { AxiosError, Method } from 'axios'
import { authenticateToken } from '../middleware/auth'

const router = express.Router()
const FUZEKEYS_URL = (process.env.FUZEKEYS_URL || 'http://fuzekeys-backend:8000').replace(/\/+$/, '')
const INTERNAL_TOKEN = process.env.FUZEKEYS_CONNECTOR_INTERNAL_TOKEN || ''

router.use(authenticateToken)

async function forward(req: Request, res: Response, method: Method, suffix: string, body?: unknown) {
  if (!INTERNAL_TOKEN) {
    res.status(503).json({ error: 'FuzeKeys connector integration is not configured' })
    return
  }
  try {
    const upstream = await axios.request({
      method,
      url: `${FUZEKEYS_URL}/api/v1/connectors/google-gmail${suffix}`,
      data: body,
      params: method === 'GET' ? req.query : undefined,
      timeout: 30000,
      validateStatus: () => true,
      headers: {
        'X-Fuze-User-Id': req.user!.id,
        'X-FuzeKeys-Internal-Token': INTERNAL_TOKEN,
      },
    })
    res.status(upstream.status).json(upstream.data)
  } catch (error) {
    const code = (error as AxiosError).code || 'EUPSTREAM'
    res.status(502).json({ error: 'FuzeKeys is unavailable', code })
  }
}

router.get('/google-gmail', (req, res) => forward(req, res, 'GET', ''))
router.patch('/google-gmail', (req, res) => forward(req, res, 'PATCH', '', req.body))
router.delete('/google-gmail', (req, res) => forward(req, res, 'DELETE', ''))
router.get('/google-gmail/messages/recent', (req, res) => forward(req, res, 'GET', '/messages/recent'))
router.post('/google-gmail/connect', (req, res) => {
  const returnTo = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/connectors`
  return forward(req, res, 'POST', '/oauth/start', { return_to: returnTo })
})

export default router
