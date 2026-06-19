import { loadConfig } from './config';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  // --- HTTP ---
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[billing-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[billing-service] Shutting down...');
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[billing-service] Fatal error:', err);
  process.exit(1);
});
