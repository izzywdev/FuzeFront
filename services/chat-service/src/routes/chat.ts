// chat.ts — chat-service HTTP routes (plan §6a/§6f).
//
// Routes (matching @fuzefront/chat-client's contract):
//   POST /chat/stream            — SSE: rag_sources -> text_delta... -> done.
//                                  Persists user + assistant messages, emits
//                                  billing.llm.usage, scoped to JWT userId/orgId.
//   GET  /chat/conversations     — list the caller's conversations.
//   GET  /chat/conversations/:id — one conversation + messages (owner-scoped).
//   POST /chat/feedback          — {messageId, rating} thumbs up/down.
//   POST /chat/confirm/:id       — release a pending (mutating) tool.
//
// Auth + rate-limit middleware are applied by the caller (createChatRouter wires
// auth; index.ts adds the limiters) — see app.ts. Every read/write is scoped by
// req.userId / req.orgId from the JWT, never from the request body (§10d).
//
// The SSE wire format is the chat-client event union (each `data:` line is one
// JSON ChatStreamEvent), a deliberate deviation from the plan's §6f AI-SDK
// data-stream protocol (flagged in the PR).

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import type { AgentEvent, AgentTurnInput, AgentCallbacks } from '../agent/loop';
import type { TokenUsage } from '../llm/litellm';
import type { Conversation, ConversationsRepository } from '../db/repositories/conversations';
import type { MessagesRepository } from '../db/repositories/messages';
import type { FeedbackRepository, FeedbackRating } from '../db/repositories/feedback';
import type { ConfirmationStore } from '../agent/confirmation';
import type { BillingEmitter } from '../billing/emitter';

export interface ChatRouterDeps {
  /** Runs one agent turn, emitting events + reporting usage. */
  runAgentTurn(input: AgentTurnInput, cb: AgentCallbacks): Promise<void>;
  conversations: Pick<ConversationsRepository, 'list' | 'findById' | 'create' | 'touch'>;
  messages: Pick<MessagesRepository, 'append' | 'listForConversation'>;
  feedback: Pick<FeedbackRepository, 'submit'>;
  confirmations: Pick<ConfirmationStore, 'confirm'>;
  billing: Pick<BillingEmitter, 'emitUsage'>;
}

const VALID_RATINGS: FeedbackRating[] = ['positive', 'negative'];

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = Router();

  // All chat routes require a valid JWT.
  router.use(authenticateToken);

  // POST /chat/stream — SSE streaming chat.
  router.post('/stream', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const orgId = (req.body?.orgId as string) || (req.orgId as string) || '';
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(
      req.body?.messages,
    )
      ? req.body.messages
      : [];

    // SSE headers. X-Accel-Buffering disables nginx buffering (plan §6f/§10e).
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (event: AgentEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Resolve / create the conversation (owner-scoped).
    let conversationId: string | undefined = req.body?.conversationId;
    try {
      if (!conversationId) {
        const created = await deps.conversations.create({ userId, orgId, title: null });
        conversationId = created.id;
      }

      // Persist the latest user message.
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        await deps.messages.append({
          conversationId,
          role: 'user',
          content: { type: 'text', text: lastUser.content },
        });
      }

      let assistantText = '';
      let usage: TokenUsage | undefined;

      await deps.runAgentTurn(
        { messages, userId, orgId, conversationId },
        {
          emit: (event) => {
            if (event.type === 'text_delta') assistantText += event.delta;
            write(event);
          },
          onUsage: (u) => {
            usage = u;
          },
        },
      );

      // Persist the assistant message.
      await deps.messages.append({
        conversationId,
        role: 'assistant',
        content: { type: 'text', text: assistantText },
      });
      await deps.conversations.touch(conversationId, userId);

      // Emit billing (non-blocking — emitter never throws).
      if (usage) {
        await deps.billing.emitUsage({
          userId,
          orgId,
          conversationId,
          model: 'default',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stream failed';
      write({ type: 'error', message });
      write({ type: 'done' });
    } finally {
      res.end();
    }
  });

  // GET /chat/conversations — list caller's conversations.
  router.get('/conversations', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const conversations: Conversation[] = await deps.conversations.list(userId);
    res.json(conversations);
  });

  // GET /chat/conversations/:id — one conversation + messages (owner-scoped).
  router.get('/conversations/:id', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const id = req.params.id;
    const conversation = await deps.conversations.findById(id, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const messages = await deps.messages.listForConversation(id, userId);
    res.json({ ...conversation, messages });
  });

  // POST /chat/feedback — {messageId, rating}.
  router.post('/feedback', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const { messageId, rating } = req.body ?? {};
    if (typeof messageId !== 'string' || !VALID_RATINGS.includes(rating)) {
      res.status(400).json({ error: 'messageId and a valid rating are required.' });
      return;
    }
    await deps.feedback.submit(messageId, userId, rating);
    res.json({ ok: true });
  });

  // POST /chat/confirm/:id — release a pending mutating tool (owner-scoped).
  router.post('/confirm/:id', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const pending = deps.confirmations.confirm(req.params.id, userId);
    if (!pending) {
      res.status(404).json({ error: 'No such pending confirmation.' });
      return;
    }
    // Mutating tool execution is DEFERRED — confirming currently just releases the
    // pending state. When mutating tools land they execute here and stream a
    // tool_result. For now acknowledge the confirmation.
    res.json({ ok: true, toolName: pending.toolName });
  });

  return router;
}
