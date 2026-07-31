import express, { Request, Response, NextFunction } from 'express'
import request from 'supertest'
import { createAdminPortalRouter, type AdminPortalStore } from '../src/routes/adminPortals'

const portal = {
  id: 'prt_acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active' as const,
  isRoot: false,
  organizationId: 'org-acme',
  ownerEmail: 'owner@example.com',
  billingMode: 'platform' as const,
  branding: { name: 'Acme' },
  identityPolicy: { allowPasswordLogin: true, allowSelfSignup: false },
  domains: [],
  primaryDomain: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
}

function appWith(store: AdminPortalStore) {
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return res.status(401).json({ error: 'missing authentication' })
    ;(req as any).user = { id: 'user-admin', roles: ['admin'] }
    next()
  }
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin/portals', createAdminPortalRouter({
    store,
    authenticate,
    authorize: (_req, _res, next) => next(),
  }))
  return app
}

describe('GET /api/v1/admin/portals', () => {
  it('200 returns the declared cursor-paginated portal fleet response', async () => {
    // @fuzequality api listPortals
    const store: AdminPortalStore = {
      list: jest.fn().mockResolvedValue({ items: [portal], nextCursor: 'next-page' }),
      create: jest.fn(),
    }
    const response = await request(appWith(store))
      .get('/api/v1/admin/portals?status=active&limit=10')
      .set('Authorization', 'Bearer test')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [portal],
      page: { nextCursor: 'next-page' },
    })
    expect(store.list).toHaveBeenCalledWith({
      status: 'active',
      query: undefined,
      limit: 10,
      cursor: undefined,
    })
  })

  it('401 when authentication is missing', async () => {
    // @fuzequality api listPortals
    const store: AdminPortalStore = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: jest.fn(),
    }
    const response = await request(appWith(store)).get('/api/v1/admin/portals')

    expect(response.status).toBe(401)
    expect(store.list).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/admin/portals', () => {
  it('201 creates a provisioned-pending-invite portal with the declared response', async () => {
    // @fuzequality api createPortal
    const created = { ...portal, status: 'provisioned-pending-invite' as const }
    const store: AdminPortalStore = {
      list: jest.fn(),
      create: jest.fn().mockResolvedValue(created),
    }
    const response = await request(appWith(store))
      .post('/api/v1/admin/portals')
      .set('Authorization', 'Bearer test')
      .send({ name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com' })

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('provisioned-pending-invite')
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-admin',
      name: 'Acme',
      slug: 'acme',
      ownerEmail: 'owner@example.com',
      billingMode: 'free',
    }))
  })

  it('401 when authentication is missing', async () => {
    // @fuzequality api createPortal
    const store: AdminPortalStore = { list: jest.fn(), create: jest.fn() }
    const response = await request(appWith(store))
      .post('/api/v1/admin/portals')
      .send({ name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com' })

    expect(response.status).toBe(401)
    expect(store.create).not.toHaveBeenCalled()
  })
})
