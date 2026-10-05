// Minimal SQL surface so the outbox/relay/consumer run on knex OR node-postgres
// without taking either as a hard dependency. SQL in this package is written with
// `$1..$n` placeholders (each used once, in order is NOT required) and adapted here.

export interface QueryResult<R = any> {
  rows: R[]
  rowCount: number
}

/** Anything that can run one parameterised statement (a connection or an open transaction). */
export interface SqlClient {
  query<R = any>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>
}

/** A pool/connection source that can open a transaction. */
export interface Db extends SqlClient {
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
}

/** Structural knex (instance or transaction) — only what we use. */
export interface KnexLike {
  raw(sql: string, bindings?: readonly unknown[]): PromiseLike<any>
}
export interface KnexRootLike extends KnexLike {
  transaction<T>(fn: (trx: KnexLike) => Promise<T>): Promise<T>
}

/** Structural node-postgres client / pooled client. */
export interface PgQueryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}
export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgQueryable & { release(err?: Error | boolean): void }>
}

/** What `enqueueEvent` accepts as "the caller's transaction". */
export type TxLike = SqlClient | KnexLike | PgQueryable

/** Rewrites `$n` placeholders to knex `?` bindings (expanding params into appearance order). */
export function toKnexBindings(sql: string, params: readonly unknown[]): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const out = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    bindings.push(params[Number(n) - 1])
    return '?'
  })
  return { sql: out, bindings }
}

export function knexSql(k: KnexLike): SqlClient {
  return {
    async query<R>(sql: string, params: readonly unknown[] = []) {
      const { sql: text, bindings } = toKnexBindings(sql, params)
      const res: any = await k.raw(text, bindings)
      // knex + pg returns the node-postgres Result.
      return { rows: (res?.rows ?? []) as R[], rowCount: res?.rowCount ?? 0 }
    },
  }
}

export function pgSql(c: PgQueryable): SqlClient {
  return {
    async query<R>(sql: string, params: readonly unknown[] = []) {
      const res = await c.query(sql, params as unknown[])
      return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 }
    },
  }
}

/** Adapts a knex instance to a `Db` (transactions via `knex.transaction`). */
export function knexDb(k: KnexRootLike): Db {
  return {
    query: (sql, params) => knexSql(k).query(sql, params),
    transaction: (fn) => k.transaction((trx) => fn(knexSql(trx))),
  }
}

/** Adapts a node-postgres Pool to a `Db` (BEGIN/COMMIT/ROLLBACK on one pooled client). */
export function pgDb(pool: PgPoolLike): Db {
  return {
    query: (sql, params) => pgSql(pool).query(sql, params),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn(pgSql(client))
        await client.query('COMMIT')
        return out
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          /* connection is likely dead; release below discards it */
        }
        throw err
      } finally {
        client.release()
      }
    },
  }
}

/**
 * Normalises whatever transaction handle the caller has into a `SqlClient`:
 * a knex trx (`.raw`), a node-postgres `PoolClient` (`.query`), or one of ours.
 */
export function asSqlClient(tx: TxLike): SqlClient {
  if (typeof (tx as KnexLike).raw === 'function') return knexSql(tx as KnexLike)
  if (typeof (tx as PgQueryable).query === 'function') {
    // Our own SqlClient has the same {rows,rowCount} result shape, so wrapping is a no-op.
    return pgSql(tx as PgQueryable)
  }
  throw new TypeError('enqueueEvent: expected a knex transaction or a node-postgres client')
}
