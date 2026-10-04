// Minimal structured JSON logger for the app-registry slice (no `pino`
// dependency in applications-service yet; this writes the same shape — one JSON
// object per line, `level`/`msg`/context, `LOG_LEVEL` honoured — so the log
// stack ingests it identically and a later swap to the shared pino logger is a
// one-file change). NEVER pass credentials: callers log shapes, not values.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

function threshold(): number {
  const l = (process.env.LOG_LEVEL || 'info').toLowerCase()
  if (l === 'silent') return Infinity
  return LEVELS[l as Level] ?? LEVELS.info
}

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold()) return
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'applications-service',
    msg,
    ...ctx,
  })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
}

/** Error -> loggable shape (message only; never the whole object / headers). */
export function errInfo(err: unknown): { err: string } {
  return { err: err instanceof Error ? err.message : String(err) }
}
