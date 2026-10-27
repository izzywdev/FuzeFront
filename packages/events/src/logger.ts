import pino from 'pino'

/** Structural logger (pino-compatible) so callers can inject their service logger. */
export interface EventsLogger {
  debug(obj: object, msg?: string): void
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

let root: pino.Logger | undefined

/** Default root logger: JSON to stdout, `LOG_LEVEL`, credentials redacted (logging skill §5). */
function rootLogger(): pino.Logger {
  if (!root) {
    root = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          '*.password',
          '*.token',
          '*.access_token',
          '*.refresh_token',
          '*.id_token',
          '*.client_secret',
          '*.apiKey',
          '*.secret',
          'password',
          'token',
          'authorization',
          'cookie',
        ],
        censor: '[REDACTED]',
      },
      base: { service: process.env.SERVICE_NAME ?? 'unknown' },
    })
  }
  return root
}

/** Child logger bound to a component (`events-relay`, `events-consumer`, ...). */
export function childLogger(component: string, bindings: Record<string, unknown> = {}): EventsLogger {
  return rootLogger().child({ component, ...bindings })
}

/** Logger that drops everything (tests). */
export const silentLogger: EventsLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
