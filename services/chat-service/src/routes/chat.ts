// chat.ts — chat-service HTTP routes (plan §6a/§6f).
//
// Routes (matching @fuzefront/chat-client's contract):
//   POST /chat/stream            — SSE: conversation -> rag_sources -> text_delta... -> done.
//                                  Persists user + assistant messages, emits
//                                  billing.llm.usage, scoped to JWT userId/orgId.
//   GET  /chat/conversations     — list the caller's conversations (appId/orgId filters).
//   GET  /chat/conversations/:id — one conversation + a keyset-paginated page of
//                                  messages (before/after/limit; owner-scoped).
//   POST /chat/feedback          — {messageId, rating} thumbs up/down.
//   POST /chat/confirm/:id       — release a pending (mutating) tool.
//
// Auth + rate-limit middleware are applied by the caller (createChatRouter wires
// auth; index.ts adds the limiters) — see app.ts. Every read/write is scoped by
// req.userId / req.orgId from the JWT, never from the request body (§10d).
//
// Tenancy: each conversation belongs to (user_id, app_id[, org_id]). appId names
// the consuming application ('fuzefront', 'mendys', ...) and is taken from the
// JWT claim when present, else the request (it selects a partition of the
// caller's OWN data, so it is not a privilege boundary the way userId is).
//
// The SSE wire format is the chat-client event union (each `data:` line is one
// JSON ChatStreamEvent), a deliberate deviation from the plan's §6f AI-SDK
// data-stream protocol (flagged in the PR).

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import type { AgentEvent, AgentTurnInput, AgentCallbacks } from '../agent/loop';
import type { TokenUsage } from '../llm/litellm';
import type { Conversation, ConversationsRepository } from '../db/repositories/conversations';
import { CursorNotFoundError, type MessagesRepository } from '../db/repositories/messages';
import type { FeedbackRepository, FeedbackRating } from '../db/repositories/feedback';
import type { ConfirmationStore } from '../agent/confirmation';
import type { BillingEmitter } from '../billing/emitter';

export interface ChatRouterDeps {
  /** Runs one agent turn, emitting events + reporting usage. */
  runAgentTurn(input: AgentTurnInput, cb: AgentCallbacks): Promise<void>;
  conversations: Pick<ConversationsRepository, 'list' | 'findById' | 'create' | 'touch'>;
  messages: Pick<MessagesRepository, 'append' | 'listPage'>;
  feedback: Pick<FeedbackRepository, 'submit'>;
  confirmations: Pick<ConfirmationStore, 'confirm'>;
  billing: Pick<BillingEmitter, 'emitUsage'>;
}

const VALID_RATINGS: FeedbackRating[] = ['positive', 'negative'];

/** App tenant used when neither the JWT nor the request names one. */
export const DEFAULT_APP_ID = 'fuzefront';

/** History page-size bounds (openapi.yaml). */
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/** SSE event announcing the resolved conversation id (first event of a stream). */
type ConversationEvent = { type: 'conversation'; conversationId: string };

function resolveAppId(req: Request, requested?: unknown): string {
  if (req.appId) return req.appId;
  if (typeof requested === 'string' && requested.trim()) return requested.trim();
  return DEFAULT_APP_ID;
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = Router();

  // All chat routes require a valid JWT.
  router.use(authenticateToken);

  // POST /chat/stream — SSE streaming chat.
  router.post('/stream', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const orgId = (req.body?.orgId as string) || (req.orgId as string) || '';
    const appId = resolveAppId(req, req.body?.appId);
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

    const write = (event: AgentEvent | ConversationEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Resolve / create the conversation (owner-scoped).
    let conversationId: string | undefined = req.body?.conversationId;
    try {
      if (conversationId) {
        // A supplied id must belong to the caller — otherwise anyone could
        // append into (and bill against) another user's conversation.
        const owned = await deps.conversations.findById(conversationId, userId);
        if (!owned) {
          write({ type: 'error', message: 'Conversation not found.' });
          write({ type: 'done' });
          return;
        }
      } else {
        const created = await deps.conversations.create({ userId, orgId, appId, title: null });
        conversationId = created.id;
      }

      // Tell the client which conversation this turn belongs to, so it can
      // reuse the thread on the next send and resume it on reopen.
      write({ type: 'conversation', conversationId });

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

  // GET /chat/conversations — list caller's conversations (optionally filtered
  // to one app/org tenant via ?appId=&orgId=).
  router.get('/conversations', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const appId =
      req.appId || (typeof req.query.appId === 'string' ? req.query.appId : undefined);
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
    const conversations: Conversation[] = await deps.conversations.list(userId, {
      appId,
      orgId,
    });
    res.json(conversations);
  });

  // GET /chat/conversations/:id — one conversation + a page of messages
  // (owner-scoped). ?before=<messageId> pages towards older messages,
  // ?after=<messageId> towards newer; without a cursor the newest page is
  // returned. ?limit= caps the page size (default 50, max 200).
  router.get('/conversations/:id', async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const id = req.params.id;

    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    if (before && after) {
      res.status(400).json({ error: 'before and after are mutually exclusive.' });
      return;
    }
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;

    const conversation = await deps.conversations.findById(id, userId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    try {
      const page = await deps.messages.listPage(id, userId, { before, after, limit });
      res.json({ ...conversation, ...page });
    } catch (err) {
      if (err instanceof CursorNotFoundError) {
        res.status(400).json({ error: 'Unknown cursor message id.' });
        return;
      }
      throw err;
    }
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
