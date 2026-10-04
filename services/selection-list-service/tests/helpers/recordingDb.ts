// A knex stand-in that RECORDS what a handler does: the ordered operations
// (`delete:selection_lists`, `update:selection_lists`, `tx:commit`, ...) and every
// (table, column) pair it filters, plucks or writes — so a test can assert both
// behaviour and schema conformance (see helpers/schema.ts).

export interface RecordingResults {
  /** `table.column` -> values returned by `.pluck(column)` */
  pluck?: Record<string, string[]>;
  /** table -> rows affected by `.update()` */
  update?: Record<string, number>;
  /** table -> rows affected by `.delete()` */
  delete?: Record<string, number>;
}

export interface RecordingDb {
  db: any;
  /** ordered operations, e.g. `pluck:selection_lists.id`, `delete:selection_list_access` */
  ops: string[];
  /** every (table, column) the handler touched */
  used: Array<[string, string]>;
  /** the arguments of every update() call, by table */
  updates: Record<string, Array<Record<string, unknown>>>;
  /** the value lists passed to whereIn(), by `table.column` */
  whereIns: Record<string, unknown[][]>;
}

export function makeRecordingDb(results: RecordingResults = {}): RecordingDb {
  const ops: string[] = [];
  const used: Array<[string, string]> = [];
  const updates: Record<string, Array<Record<string, unknown>>> = {};
  const whereIns: Record<string, unknown[][]> = {};

  const builder = (table: string): any => {
    let mode: 'select' | 'update' | 'delete' | 'pluck' | 'count' = 'select';
    let pluckCol = '';
    const note = (col: string): void => {
      used.push([table, col.split(/\s+as\s+/i)[0]]);
    };
    const b: any = {
      where(a: unknown, _op?: unknown, _v?: unknown) {
        if (a && typeof a === 'object') Object.keys(a as object).forEach(note);
        else if (typeof a === 'string') note(a);
        return b;
      },
      whereIn(col: string, vals: unknown[]) {
        note(col);
        (whereIns[`${table}.${col}`] ??= []).push(vals);
        return b;
      },
      whereNull(col: string) {
        note(col);
        return b;
      },
      update(patch: Record<string, unknown>) {
        mode = 'update';
        Object.keys(patch).forEach(note);
        (updates[table] ??= []).push(patch);
        return b;
      },
      delete() {
        mode = 'delete';
        return b;
      },
      pluck(col: string) {
        mode = 'pluck';
        pluckCol = col;
        note(col);
        return b;
      },
      count(spec: string) {
        mode = 'count';
        note(spec);
        return b;
      },
      first() {
        return b;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        let out: unknown;
        if (mode === 'update') {
          ops.push(`update:${table}`);
          out = results.update?.[table] ?? 0;
        } else if (mode === 'delete') {
          ops.push(`delete:${table}`);
          out = results.delete?.[table] ?? 0;
        } else if (mode === 'pluck') {
          ops.push(`pluck:${table}.${pluckCol}`);
          out = results.pluck?.[`${table}.${pluckCol}`] ?? [];
        } else if (mode === 'count') {
          ops.push(`count:${table}`);
          out = { n: '0' };
        } else {
          ops.push(`select:${table}`);
          out = undefined;
        }
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return b;
  };

  const db: any = (table: string) => builder(table);
  db.fn = { now: () => new Date() };
  db.transaction = async (cb: (trx: any) => Promise<unknown>) => {
    ops.push('tx:begin');
    try {
      const out = await cb(db);
      ops.push('tx:commit');
      return out;
    } catch (err) {
      ops.push('tx:rollback');
      throw err;
    }
  };

  return { db, ops, used, updates, whereIns };
}
