// config.ts — reads env vars set by the Helm chat-service.yaml template.
// Every env var listed here MUST correspond to one set in the Helm template
// (or injected locally). Do not read env vars from request body (§10d).

export interface Config {
  port: number;
  nodeEnv: string;

  // Upstream services (set by Helm chatService.* values)
  litellmUrl: string;
  chromaUrl: string;
  backendUrl: string;
  permitPdpUrl: string;

  // Kafka
  kafka: {
    brokers: string[];
  };

  // Postgres — individual components (set by Helm fuzeinfra.postgres.* + database.*)
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };

  // Auth
  jwtSecret: string;

  // Redis (not in Helm template yet — see mismatch note in unit4-report.md)
  redisUrl: string;

  // AI provider keys (optional — injected by Helm when secret.* non-empty)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  litellmMasterKey?: string;

  // Rate-limit settings (defaults align with §10f: 20/60/100 per minute)
  rateLimit: {
    streamWindowMs: number;
    streamMax: number;
    confirmWindowMs: number;
    confirmMax: number;
    globalWindowMs: number;
    globalMax: number;
  };
}

export function loadConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'kafka.fuzeinfra.svc.cluster.local:9092')
    .split(',')
    .map((b) => b.trim());

  return {
    port: parseInt(process.env.PORT || '3006', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    litellmUrl: process.env.LITELLM_URL || 'http://litellm.fuzeinfra.svc.cluster.local:4000',
    chromaUrl: process.env.CHROMA_URL || 'http://chromadb.fuzeinfra.svc.cluster.local:8000',
    backendUrl: process.env.BACKEND_URL || 'http://fuzefront-backend:3001',
    permitPdpUrl: process.env.PERMIT_PDP_URL || 'http://fuzefront-permit-pdp:7000',

    kafka: { brokers },

    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      name: process.env.DB_NAME || 'fuzefront_platform',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },

    jwtSecret: process.env.JWT_SECRET || '',

    // REDIS_URL: not currently set by the Helm template (see unit4-report.md §Mismatch).
    // Falls back to constructing from fuzeinfra redis defaults.
    redisUrl: process.env.REDIS_URL || 'redis://redis.fuzeinfra.svc.cluster.local:6379',

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    litellmMasterKey: process.env.LITELLM_MASTER_KEY,

    rateLimit: {
      streamWindowMs: parseInt(process.env.RATE_LIMIT_STREAM_WINDOW_MS || '60000', 10),
      streamMax: parseInt(process.env.RATE_LIMIT_STREAM_MAX || '20', 10),
      confirmWindowMs: parseInt(process.env.RATE_LIMIT_CONFIRM_WINDOW_MS || '60000', 10),
      confirmMax: parseInt(process.env.RATE_LIMIT_CONFIRM_MAX || '60', 10),
      globalWindowMs: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || '60000', 10),
      globalMax: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '100', 10),
    },
  };
}
