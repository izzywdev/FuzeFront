import { createApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[chat-service] Listening on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[chat-service] Shutting down...');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[chat-service] Fatal error:', err);
  process.exit(1);
});
