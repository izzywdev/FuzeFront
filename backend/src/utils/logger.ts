// The one shared structured logger for new backend code (logging skill §1/§5):
// pino JSON to stdout (the platform's Loki stack ingests it), verbosity from
// LOG_LEVEL (prod default `info`; flip to `debug` without a redeploy of code),
// and credentials redacted at the logger rather than at each call site.
//
// Legacy modules still use console.*; they migrate opportunistically. New code
// imports `logger` from here.
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      '*.id_token',
      '*.code',
      '*.otp',
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
  base: { service: process.env.SERVICE_NAME ?? 'fuzefront-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
})
