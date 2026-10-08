/**
 * Unit tests for the self-service account routes (`/api/me`) — the emit side of
 * `identity.user.updated` / `identity.user.deleted` (FFRNT-172).
 *
 * `@fuzefront/core` is mocked so `enqueueEvent` is a spy (asserted directly) and
 * `authenticateToken` injects a mutable test user; `db` is a tiny in-memory
 * users-table fake with a pass-through `transaction`. No real Postgres/Kafka.
 */
import request from 'supertest'
import express from 'express'
import { TOPICS } from '@fuzefront/shared/kafka'

type UserRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  is_active?: boolean
  deactivated_at?: Date | null
  updated_at?: Date
}

let mockUsers: UserRow[] = []
let mockCurrentUserId: string | null = 'user-1'
const mockEnqueueEvent = jest.fn()

jest.mock('@fuzefront/core', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    if (mockCurrentUserId) req.user = { id: mockCurrentUserId }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  enqueueEvent: (...args: any[]) => mockEnqueueEvent(...args),
}))

jest.mock('../src/config/database', () => {
  function usersTable() {
    return {
      where(col: string, val: any) {
        const find = () => mockUsers.find(u => (u as any)[col] === val)
        return {
          async first() {
            const row = find()
            return row ? { ...row } : undefined
          },
          async update(obj: any) {
            const row = find()
            if (row) Object.assign(row, obj)
            return row ? 1 : 0
          },
        }
      },
    }
  }
  const dbFn: any = (_table: string) => usersTable()
  dbFn.transaction = async (cb: any) => cb(dbFn)
  return { db: dbFn }
})

// Imported AFTER the mocks are registered.
import meRoutes from '../src/routes/me'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/me', meRoutes)
  return app
}

beforeEach(() => {
  mockEnqueueEvent.mockReset()
  mockCurrentUserId = 'user-1'
  mockUsers = [
    {
      id: 'user-1',
      email: 'u@example.com',
      first_name: 'Old',
      last_name: 'Name',
      is_active: true,
      deactivated_at: null,
    },
  ]
})

describe('PATCH /api/me', () => {
  it('updates the profile and emits identity.user.updated', async () => {
    const res = await request(makeApp()).patch('/api/me').send({ firstName: 'New' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
    expect(res.body.user).toMatchObject({ id: 'user-1', firstName: 'New', lastName: 'Name' })
    expect(mockEnqueueEvent).toHaveBeenCalledTimes(1)
    const [, topic, payload] = mockEnqueueEvent.mock.calls[0]
    expect(topic).toBe(TOPICS.IDENTITY_USER_UPDATED)
    expect(payload).toEqual({
      userId: 'user-1',
      email: 'u@example.com',
      firstName: 'New',
      lastName: 'Name',
    })
    expect(mockUsers[0].first_name).toBe('New')
  })

  it('emits no event when nothing actually changes (diff-guard)', async () => {
    const res = await request(makeApp()).patch('/api/me').send({ firstName: 'Old', lastName: 'Name' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(false)
    expect(mockEnqueueEvent).not.toHaveBeenCalled()
  })

  it('rejects unknown fields (400) and never emits', async () => {
    const res = await request(makeApp()).patch('/api/me').send({ role: 'admin', id: 'other' })
    expect(res.status).toBe(400)
    expect(mockEnqueueEvent).not.toHaveBeenCalled()
  })

  it('rejects an empty body (400)', async () => {
    const res = await request(makeApp()).patch('/api/me').send({})
    expect(res.status).toBe(400)
  })

  it('is unauthorized without an authenticated user (401)', async () => {
    mockCurrentUserId = null
    const res = await request(makeApp()).patch('/api/me').send({ firstName: 'X' })
    expect(res.status).toBe(401)
    expect(mockEnqueueEvent).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/me', () => {
  it('deactivates the account and emits identity.user.deleted (cascade soft)', async () => {
    const res = await request(makeApp()).delete('/api/me')
    expect(res.status).toBe(200)
    expect(res.body.deactivated).toBe(true)
    expect(mockUsers[0].is_active).toBe(false)
    expect(mockUsers[0].deactivated_at).toBeInstanceOf(Date)
    expect(mockEnqueueEvent).toHaveBeenCalledTimes(1)
    const [, topic, payload] = mockEnqueueEvent.mock.calls[0]
    expect(topic).toBe(TOPICS.IDENTITY_USER_DELETED)
    expect(payload).toEqual({ userId: 'user-1', email: 'u@example.com', cascade: 'soft' })
  })

  it('is an idempotent no-op when already deactivated (no event)', async () => {
    mockUsers[0].is_active = false
    const res = await request(makeApp()).delete('/api/me')
    expect(res.status).toBe(200)
    expect(res.body.deactivated).toBe(false)
    expect(mockEnqueueEvent).not.toHaveBeenCalled()
  })
})
