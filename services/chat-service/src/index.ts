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
import { PermitClient } from './agent/permit';
import { BackendActionClient } from './agent/backend-client';
import { ConversationsRepository } from './db/repositories/conversations';
import { MessagesRepository } from './db/repositories/messages';
import { FeedbackRepository } from './db/repositories/feedback';
import { AuditLogRepository } from './db/repositories/audit';
import { BillingEmitter } from './billing/emitter';
import { createKafkaClient, TypedProducer } from '@fuzefront/shared';

async function main() {
  const config = loadConfig();

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

  // --- Mutating tools: backend action client + Permit PDP gate ---
  const backend = new BackendActionClient({ baseUrl: config.backendUrl });
  const permit = new PermitClient({ pdpUrl: config.permitPdpUrl });
  const registry = buildToolRegistry({ retriever, backend });
  const searchTool = createSearchDocsTool(retriever);

  // --- Persistence ---
  const conversations = new ConversationsRepository(db);
  const messages = new MessagesRepository(db);
  const feedback = new FeedbackRepository(db);
  const audit = new AuditLogRepository(db);

  // --- Confirmation gate (mutating tools execute on /chat/confirm/:id) ---
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
      registry,
      permit,
      audit,
    },
  });

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[chat-service] Listening on port ${config.port}`);
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[chat-service] Shutting down...');
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
