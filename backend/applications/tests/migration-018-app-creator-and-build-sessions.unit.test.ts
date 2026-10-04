/**
 * Unit tests for migrations/018_app_creator_and_build_sessions.ts — asserts the
 * DDL shape and, crucially, that every statement is idempotent (re-runnable).
 */
import { up, down } from '../src/migrations/018_app_creator_and_build_sessions'

function fakeKnex() {
  const sql: string[] = []
  return { sql, knex: { raw: async (s: string) => void sql.push(s.replace(/\s+/g, ' ').trim()) } as any }
}

describe('migration 018 — creator + build sessions', () => {
  it('adds a nullable, ON DELETE SET NULL created_by_user_id + index', async () => {
    const { knex, sql } = fakeKnex()
    await up(knex)
    const col = sql.find(s => s.includes('ADD COLUMN IF NOT EXISTS created_by_user_id'))!
    expect(col).toMatch(/created_by_user_id uuid NULL REFERENCES users\(id\) ON DELETE SET NULL/)
    expect(sql.some(s => /CREATE INDEX IF NOT EXISTS apps_created_by_user_id_idx/.test(s))).toBe(true)
  })

  it('creates app_build_sessions with the required columns, enums and FKs', async () => {
    const { knex, sql } = fakeKnex()
    await up(knex)
    const t = sql.find(s => s.startsWith('CREATE TABLE IF NOT EXISTS app_build_sessions'))!
    expect(t).toMatch(/id uuid PRIMARY KEY/)
    expect(t).toMatch(/organization_id uuid NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/)
    expect(t).toMatch(/requested_by_user_id uuid NULL REFERENCES users\(id\) ON DELETE SET NULL/)
    expect(t).toMatch(/app_id uuid NULL REFERENCES apps\(id\) ON DELETE SET NULL/)
    for (const c of ['context', 'name text NOT NULL', 'brief text NOT NULL', 'status',
      'agent_session_ref text NULL', 'agent_session_url text NULL',
      'error_code text NULL', 'error_message text NULL', 'created_at', 'updated_at']) {
      expect(t).toContain(c)
    }
    const status = sql.find(s => s.includes('app_build_status_enum AS ENUM'))!
    for (const v of ['requested', 'launching', 'building', 'deploying', 'deployed', 'failed', 'cancelled']) {
      expect(status).toContain(`'${v}'`)
    }
    expect(sql.find(s => s.includes('app_build_context_enum AS ENUM'))).toMatch(/'personal', 'organization'/)
    expect(sql.some(s => /app_build_sessions_org_created_idx.*\(organization_id, created_at\)/.test(s))).toBe(true)
    expect(sql.some(s => /app_build_sessions_requester_created_idx.*\(requested_by_user_id, created_at\)/.test(s))).toBe(true)
  })

  it('is idempotent: every statement carries an IF NOT EXISTS / duplicate_object guard', async () => {
    const { knex, sql } = fakeKnex()
    await up(knex)
    await up(knex) // re-run must be a statement-for-statement repeat of guarded DDL
    for (const s of sql) {
      expect(s).toMatch(/IF NOT EXISTS|duplicate_object/)
    }
  })

  it('down() drops everything it created, IF EXISTS', async () => {
    const { knex, sql } = fakeKnex()
    await down(knex)
    expect(sql.length).toBeGreaterThanOrEqual(4)
    for (const s of sql) expect(s).toMatch(/IF EXISTS/)
  })
})
