import { loadConfig } from './config';
import { createTwilioClient } from './twilio-client';
import { RateLimiter } from './rate-limiter';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  const twilioClient = createTwilioClient(config.twilio);
  const rateLimiter = new RateLimiter(config.rateLimiter);

  const app = createApp({
    authSecret: config.authSecret,
    twilioClient,
    verifyServiceSid: config.twilio.verifyServiceSid,
    rateLimiter,
  });

  const server = app.listen(config.port, () => {
    const mode = config.twilio.mock ? 'mock' : 'live';
    console.log(`[sms-service] Listening on port ${config.port} (Twilio: ${mode})`);
  });

  const shutdown = () => {
    console.log('[sms-service] Shutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[sms-service] Fatal error:', err);
  process.exit(1);
});
