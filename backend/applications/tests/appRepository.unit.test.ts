/**
 * Unit tests for applications/src/repositories/appRepository.ts — step 3 of
 * FFRNT-185.
 *
 * Verifies that typed repository functions:
 * - Accept EntityId<'app'> and send the native UUID (not TypeID wire form) to
 *   the DB.
 * - Return row data unmodified (serialization is handled at the route layer).
 *
 * No DB, no network — pure unit tests using a mock knex builder.
 */

import { fromUuid } from '@izzywdev/fuzefront-identity'
import {
  findAppById,
  findActiveAppById,
  setAppActive,
  deleteApp,
} from '../src/repositories/appRepository'

// ── knex mock factory ──────────────────────────────────────────────────────────

const NOT_FOUND = Symbol('NOT_FOUND')

function makeDb(returnValue: any = { id: 'some-uuid', name: 'Clock' }) {
  // Resolve sentinel to undefined (knex returns undefined, not null, on no match).
  const resolvedReturn = returnValue === NOT_FOUND ? undefined : returnValue
  const captured: {
    table?: string
    where?: any
    updateArgs?: any
    deleted?: boolean
  } = {}

  const builder: any = {
    where(args: any) {
      captured.where = { ...(captured.where || {}), ...args }
      return builder
    },
    update(args: any) {
      captured.updateArgs = args
      return Promise.resolve(1)
    },
    del() {
      captured.deleted = true
      return Promise.resolve(1)
    },
    first() {
      return Promise.resolve(resolvedReturn)
    },
  }

  const db: any = (table: string) => {
    captured.table = table
    return builder
  }
  db.fn = { now: () => new Date() }
  db._captured = captured
  return db
}

const APP_UUID = '0195a8f2-6c3d-7000-b000-000000000010'
const APP_ID = fromUuid('app', APP_UUID)

describe('findAppById', () => {
  it('queries apps table by native UUID, not TypeID', async () => {
    const db = makeDb({ id: APP_UUID, name: 'Clock' })
    await findAppById(APP_ID, db)
    expect(db._captured.table).toBe('apps')
    expect(db._captured.where).toEqual({ id: APP_UUID })
  })

  it('does not pass the TypeID wire form to the DB', async () => {
    const db = makeDb()
    await findAppById(APP_ID, db)
    expect(db._captured.where.id).not.toMatch(/^app_/)
  })

  it('returns the DB row as-is', async () => {
    const row = { id: APP_UUID, name: 'Clock', is_active: true }
    const db = makeDb(row)
    const result = await findAppById(APP_ID, db)
    expect(result).toEqual(row)
  })

  it('returns undefined when not found', async () => {
    const db = makeDb(NOT_FOUND)
    const result = await findAppById(APP_ID, db)
    expect(result).toBeUndefined()
  })
})

describe('findActiveAppById', () => {
  it('queries apps table with id AND is_active=true', async () => {
    const db = makeDb({ id: APP_UUID, is_active: true })
    await findActiveAppById(APP_ID, db)
    expect(db._captured.table).toBe('apps')
    expect(db._captured.where).toEqual({ id: APP_UUID, is_active: true })
  })

  it('returns undefined when app is inactive (not found)', async () => {
    const db = makeDb(NOT_FOUND)
    const result = await findActiveAppById(APP_ID, db)
    expect(result).toBeUndefined()
  })
})

describe('setAppActive', () => {
  it('updates apps table by native UUID', async () => {
    const db = makeDb()
    await setAppActive(APP_ID, false, db)
    expect(db._captured.table).toBe('apps')
    expect(db._captured.where).toEqual({ id: APP_UUID })
    expect(db._captured.updateArgs).toMatchObject({ is_active: false })
  })

  it('sets is_active=true when toggling on', async () => {
    const db = makeDb()
    await setAppActive(APP_ID, true, db)
    expect(db._captured.updateArgs).toMatchObject({ is_active: true })
  })
})

describe('deleteApp', () => {
  it('deletes from apps table by native UUID', async () => {
    const db = makeDb()
    await deleteApp(APP_ID, db)
    expect(db._captured.table).toBe('apps')
    expect(db._captured.where).toEqual({ id: APP_UUID })
    expect(db._captured.deleted).toBe(true)
  })
})

// ── compile-time guard ────────────────────────────────────────────────────────
describe('EntityId<app> branded type (compile-time)', () => {
  it('fromUuid returns a branded EntityId<app> accepted by findAppById', async () => {
    const appId = fromUuid('app', APP_UUID)
    const db = makeDb({ id: APP_UUID })
    await expect(findAppById(appId, db)).resolves.toBeDefined()
  })
})
