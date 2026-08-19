import { createApp } from './app';
import { loadConfig } from './config';
import { db } from './db';
import { LiteLLMClient } from './llm/litellm';
import { ChromaClient } from './rag/chroma';
import { Embedder } from './rag/embedder';
import { Retriever } from './rag/retriever';
import { buildToolRegistry } from './agent/tools';
import { createSearchDocsTool } from './agent/tools/search-docs';
import { runAgentTurn, AgentTurnInput, AgentCallbacks } from './agent/loop';
import { ConfirmationStore } from './agent/confirmation';
import { ConversationsRepository } from './db/repositories/conversations';
import { MessagesRepository } from './db/repositories/messages';
import { FeedbackRepository } from './db/repositories/feedback';
import { BillingEmitter } from './billing/emitter';
import { createKafkaClient, TypedProducer } from '@fuzefront/shared';
import { startRefIndexProjection, stopRefIndexProjection } from './kafka/ref-index.consumer';
import { KnexRefIndexRepository } from './repositories/ref-index.repository';

async function main() {
  const config = loadConfig();

  // Run all migrations (including the new 003_ref_index migration) at startup.
  // Best-effort: migration failure is logged but does not abort the service.
  try {
    await db.migrate.latest();
    // eslint-disable-next-line no-console
    console.log('[chat-service] Database migrations complete');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[chat-service] Migration failed (continuing):', err);
  }

  // --- LLM gateway + RAG pipeline (read-only retrieval) ---
  const llm = new LiteLLMClient({
    baseUrl: config.litellmUrl,
    defaultModel: process.env.LITELLM_DEFAULT_MODEL || 'claude-opus-4-5',
    embeddingModel: process.env.LITELLM_EMBEDDING_MODEL || 'text-embedding-3-small',
    masterKey: config.litellmMasterKey,
  });
  const chroma = new ChromaClient({ baseUrl: config.chromaUrl });
  const embedder = new Embedder(llm);
  const retriever = new Retriever(chroma, embedder);
  const registry = buildToolRegistry({ retriever });
  const searchTool = createSearchDocsTool(retriever);

  // --- Persistence ---
  const conversations = new ConversationsRepository(db);
  const messages = new MessagesRepository(db);
  const feedback = new FeedbackRepository(db);

  // --- Confirmation gate (mutating tools deferred; store is ready) ---
  const confirmations = new ConfirmationStore();

  // --- Billing emitter (Kafka, non-blocking) ---
  const kafka = createKafkaClient({
    clientId: 'chat-service',
    brokers: config.kafka.brokers,
  });
  const producer = new TypedProducer(kafka);
  producer.connect().catch((err) => {
    // Non-fatal: billing degrades gracefully if Kafka is unavailable.
    // eslint-disable-next-line no-console
    console.warn('[chat-service] Kafka producer connect failed (billing degraded):', err);
  });
  const billing = new BillingEmitter(producer);

  // --- L1 referential-integrity projection (FFRNT P2) ---
  // Projects identity.user.* and identity.org.* events into chat_ref_index so
  // assertRefExists can answer at request time without an RPC to the owning
  // services. Non-fatal + no-op when KAFKA_BROKERS is unset.
  const refIndexStore = new KnexRefIndexRepository(db);
  await startRefIndexProjection(refIndexStore);

  // --- App ---
  const app = createApp({
    chat: {
      runAgentTurn: (input: AgentTurnInput, cb: AgentCallbacks) =>
        runAgentTurn({ llm, searchTool, registry }, input, cb),
      conversations,
      messages,
      feedback,
      confirmations,
      billing,
    },
  });

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[chat-service] Listening on port ${config.port}`);
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[chat-service] Shutting down...');
    await stopRefIndexProjection().catch(() => {});
    await producer.disconnect().catch(() => {});
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[chat-service] Fatal error:', err);
  process.exit(1);
});
