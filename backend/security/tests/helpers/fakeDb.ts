/**
 * A tiny in-memory stand-in for the knex surface the invitations-v2 code uses.
 * It evaluates real where/order/limit/insert/update semantics against plain
 * arrays so the tests assert BEHAVIOR (CAS single-winner, keyset pagination,
 * outbox atomicity) rather than just "was a mock called".
 *
 * Deliberately small: only the operators the v2 code needs are implemented; an
 * unsupported whereRaw/raw throws so a silent no-op can never mask a bug.
 */
type Row = Record<string, any>

const clone = <T>(v: T): T =>
  JSON.parse(JSON.stringify(v), (_k, val) =>
    typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(val) ? new Date(val) : val
  )

const cmp = (a: any, b: any): number => {
  const x = a instanceof Date ? a.getTime() : a
  const y = b instanceof Date ? b.getTime() : b
  return x < y ? -1 : x > y ? 1 : 0
}

class Query {
  private preds: Array<(r: Row) => boolean> = []
  private orders: Array<{ col: string; dir: 'asc' | 'desc' }> = []
  private lim: number | null = null
  private cols: string[] | null = null

  constructor(
    private store: FakeDb,
    private table: string
  ) {}

  where(a: any, b?: any, c?: any): this {
    if (typeof a === 'object' && a !== null) {
      for (const [k, v] of Object.entries(a)) this.preds.push(r => r[k] === v)
    } else if (c === undefined) {
      this.preds.push(r => (b === null ? r[a] == null : r[a] === b))
    } else {
      const op = b as string
      this.preds.push(r => {
        const d = cmp(r[a], c)
        return op === '>' ? d > 0 : op === '>=' ? d >= 0 : op === '<' ? d < 0 : op === '<=' ? d <= 0 : r[a] === c
      })
    }
    return this
  }
  whereIn(col: string, vals: any[]): this {
    this.preds.push(r => vals.includes(r[col]))
    return this
  }
  whereRaw(sql: string, params: any[] = []): this {
    if (/LOWER\(email\) = \?/.test(sql)) {
      this.preds.push(r => String(r.email ?? '').toLowerCase() === params[0])
    } else if (/\(created_at, id\) < \(\?(::timestamptz)?, \?(::uuid)?\)/.test(sql)) {
      this.preds.push(r => cmp(r.created_at, new Date(params[0])) < 0 || (cmp(r.created_at, new Date(params[0])) === 0 && r.id < params[1]))
    } else if (/status = 'expired' OR/.test(sql)) {
      this.preds.push(r => r.status === 'expired' || (r.status === 'pending' && cmp(r.expires_at, new Date()) <= 0))
    } else {
      throw new Error(`fakeDb: unsupported whereRaw: ${sql}`)
    }
    return this
  }
  select(...cols: any[]): this {
    // '*' (+ raw expressions the fake does not evaluate) => whole row.
    this.cols = cols.some(c => c === '*' || typeof c !== 'string') ? null : cols.flat()
    return this
  }
  orderBy(col: string, dir: 'asc' | 'desc' = 'asc'): this {
    this.orders.push({ col, dir })
    return this
  }
  limit(n: number): this {
    this.lim = n
    return this
  }
  private run(): Row[] {
    let rows = this.store.tables[this.table].filter(r => this.preds.every(p => p(r)))
    for (const { col, dir } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (dir === 'asc' ? cmp(a[col], b[col]) : cmp(b[col], a[col])))
    }
    if (this.lim !== null) rows = rows.slice(0, this.lim)
    if (this.cols) rows = rows.map(r => Object.fromEntries(this.cols!.map(c => [c, r[c]])))
    return rows
  }
  async first(): Promise<Row | undefined> {
    const r = this.run()[0]
    return r ? { ...r } : undefined
  }
  async insert(row: Row | Row[]): Promise<number[]> {
    const rows = Array.isArray(row) ? row : [row]
    for (const r of rows) {
      const withDefaults = this.store.defaults(this.table, r)
      this.store.tables[this.table].push(withDefaults)
    }
    return rows.map((_, i) => i)
  }
  async update(patch: Row): Promise<number> {
    const rows = this.store.tables[this.table].filter(r => this.preds.every(p => p(r)))
    rows.forEach(r => Object.assign(r, patch))
    return rows.length
  }
  async delete(): Promise<number> {
    const keep = this.store.tables[this.table].filter(r => !this.preds.every(p => p(r)))
    const n = this.store.tables[this.table].length - keep.length
    this.store.tables[this.table] = keep
    return n
  }
  then(resolve: (v: Row[]) => any, reject?: (e: any) => any) {
    try {
      return Promise.resolve(this.run().map(r => ({ ...r }))).then(resolve, reject)
    } catch (e) {
      return Promise.reject(e).then(resolve, reject)
    }
  }
}

export const ROOT = '00000000-0000-0000-0000-000000000010'

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** Set to make every raw()/CAS observe contention (not used by default). */
  constructor() {
    this.reset()
  }
  reset() {
    this.tables = {
      users: [],
      organizations: [],
      organization_memberships: [],
      organization_invitations: [],
      event_outbox: [],
    }
  }
  defaults(table: string, r: Row): Row {
    const base = { ...r }
    if (table === 'organization_invitations') {
      base.created_at ??= new Date()
      base.status ??= 'pending'
      base.channel ??= 'email'
      base.member_type ??= 'employee'
      base.bind_token ??= null
      base.bind_token_expires_at ??= null
      base.invitee_user_id ??= null
      base.phone ??= null
      base.email ??= null
    }
    if (table === 'organization_memberships') {
      base.member_type ??= 'employee'
      base.status ??= 'active'
    }
    return base
  }
  /** knex-callable facade */
  fn = Object.assign((table: string) => new Query(this, table), {
    raw: (sql: string, params: any[] = []) =>
      /AS created_at_cursor/.test(sql) ? { __rawSelect: true } : this.rawAsync(sql, params),
    transaction: async (cb: (trx: any) => Promise<any>) => {
      const snapshot = clone(this.tables)
      try {
        return await cb(this.fn)
      } catch (e) {
        this.tables = snapshot // rollback: state change AND outbox rows vanish together
        throw e
      }
    },
  })
  private async rawAsync(sql: string, params: any[]) {
    return this.raw(sql, params)
  }
  private raw(sql: string, params: any[]) {
    if (/UPDATE organization_invitations/.test(sql) && /SET status\s*=\s*'accepted'/.test(sql)) {
      const row = this.tables.organization_invitations.find(
        r => r.id === params[0] && r.status === 'pending' && cmp(r.expires_at, new Date()) > 0
      )
      if (!row) return { rowCount: 0, rows: [] }
      Object.assign(row, { status: 'accepted', bind_token: null, bind_token_expires_at: null })
      return { rowCount: 1, rows: [{ id: row.id }] }
    }
    if (/WITH RECURSIVE anc/.test(sql)) {
      const rows: Row[] = []
      let cur = this.tables.organizations.find(o => o.id === params[0])
      while (cur && rows.length < 16) {
        rows.push({ id: cur.id, parent_id: cur.parent_id ?? null })
        cur = cur.parent_id ? this.tables.organizations.find(o => o.id === cur!.parent_id) : undefined
      }
      return { rows, rowCount: rows.length }
    }
    throw new Error(`fakeDb: unsupported raw: ${sql}`)
  }
}

export const fakeDb = new FakeDb()
export const db = fakeDb.fn

/** `enqueueEvent` stand-in that writes the outbox row through the (transactional) fake. */
export async function enqueueEvent(trx: any, topic: string, payload: unknown, correlationId: string) {
  await trx('event_outbox').insert({ topic, payload, correlation_id: correlationId, status: 'pending' })
}

export const outbox = (topic?: string) =>
  fakeDb.tables.event_outbox.filter(e => !topic || e.topic === topic)
