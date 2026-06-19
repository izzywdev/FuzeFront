import { ensureDatabase } from '../src/config/database'

// These tests pin the post-A0 contract of ensureDatabase(): runtime must NOT
// create the database (that is the privileged bootstrap Job's responsibility).
// ensureDatabase() is now a least-privilege existence/reachability check:
//   - resolves when the configured DB exists,
//   - rejects with a clear, actionable error when it does not,
//   - never issues CREATE DATABASE.
describe('ensureDatabase (least-privilege, no CREATE DATABASE)', () => {
  const origQuery = require('pg').Client.prototype.query
  const origConnect = require('pg').Client.prototype.connect
  const origEnd = require('pg').Client.prototype.end

  afterEach(() => {
    require('pg').Client.prototype.query = origQuery
    require('pg').Client.prototype.connect = origConnect
    require('pg').Client.prototype.end = origEnd
  })

  it('does not issue CREATE DATABASE and resolves when the DB exists', async () => {
    const queries: string[] = []
    require('pg').Client.prototype.connect = jest.fn().mockResolvedValue(undefined)
    require('pg').Client.prototype.end = jest.fn().mockResolvedValue(undefined)
    require('pg').Client.prototype.query = jest.fn((sql: string) => {
      queries.push(sql)
      // pg_database existence probe -> found
      return Promise.resolve({ rows: [{ exists: 1 }] })
    })

    await expect(ensureDatabase()).resolves.toBeUndefined()
    expect(queries.some(q => /CREATE\s+DATABASE/i.test(q))).toBe(false)
  })

  it('rejects with an actionable error when the DB is absent (bootstrap missing)', async () => {
    const queries: string[] = []
    require('pg').Client.prototype.connect = jest.fn().mockResolvedValue(undefined)
    require('pg').Client.prototype.end = jest.fn().mockResolvedValue(undefined)
    require('pg').Client.prototype.query = jest.fn((sql: string) => {
      queries.push(sql)
      // pg_database existence probe -> not found
      return Promise.resolve({ rows: [] })
    })

    await expect(ensureDatabase()).rejects.toThrow(/does not exist|bootstrap/i)
    expect(queries.some(q => /CREATE\s+DATABASE/i.test(q))).toBe(false)
  })
})
