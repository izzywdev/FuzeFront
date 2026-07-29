// config.ts — reads env vars set by the Helm notification-service.yaml template.
// Every var here MUST correspond to one set in that template (or injected
// locally). Never read configuration out of a request body.

export interface Config {
  port: number;
  nodeEnv: string;

  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };

  /** Verifies the platform JWT the browser already holds. */
  jwtSecret: string;

  /**
   * Shared secret for `/internal/*`. Other services publish notifications with
   * it; the browser never sees it. Empty means the internal surface is DISABLED
   * — fail closed rather than run an unauthenticated publish endpoint.
   */
  internalToken: string;

  /** SSE heartbeat interval. Keeps proxies from reaping an idle stream. */
  sseHeartbeatMs: number;
  /** Hard cap on concurrent streams per user, so one tab-hoarder cannot pin a pod. */
  maxStreamsPerUser: number;

  rateLimit: {
    windowMs: number;
    max: number;
  };
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3008', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      name: process.env.DB_NAME || 'fuzefront_platform',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },

    jwtSecret: process.env.JWT_SECRET || '',
    internalToken: process.env.NOTIFICATION_INTERNAL_TOKEN || '',

    sseHeartbeatMs: parseInt(process.env.SSE_HEARTBEAT_MS || '25000', 10),
    maxStreamsPerUser: parseInt(process.env.MAX_STREAMS_PER_USER || '5', 10),

    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      max: parseInt(process.env.RATE_LIMIT_MAX || '240', 10),
    },
  };
}
