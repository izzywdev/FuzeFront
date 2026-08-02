import express, { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireInternalToken } from '../middleware/auth';
import {
  NotificationCategory,
  NotificationsRepository,
} from '../db/repositories/notifications';
import {
  CATEGORIES,
  CHANNELS,
  NotificationChannel,
  PreferencesRepository,
} from '../db/repositories/preferences';
import { StreamHub } from '../stream/hub';

/**
 * The notification API.
 *
 * Every user-facing route derives `user_id` from the VERIFIED token
 * (middleware/auth.ts) and never from the request. There is no route that
 * accepts a user id at all, so there is nothing to tamper into another user's
 * mailbox — the repository's `where('user_id', …)` predicate is the second
 * layer, not the only one.
 *
 * `/internal/publish` is the one privileged route: it names its recipients, and
 * is gated on the shared service token instead of a user JWT.
 */

export interface NotificationRouterDeps {
  notifications: NotificationsRepository;
  preferences: PreferencesRepository;
  hub: StreamHub;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const categorySchema = z.enum(['system', 'billing', 'security', 'app', 'social']);
const severitySchema = z.enum(['info', 'success', 'warning', 'error']);

const listQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  category: categorySchema.optional(),
  status: z.enum(['unread', 'read', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: z.string().optional(),
});

const scopeBodySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

const preferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: categorySchema,
        channel: z.enum(['in_app', 'email', 'sms', 'push']),
        enabled: z.boolean(),
      })
    )
    .max(CATEGORIES.length * CHANNELS.length),
});

const publishSchema = z.object({
  // Explicit recipient list. This service does NOT resolve "everyone in org X"
  // itself — membership lives in the platform database and duplicating that
  // query here would be a second, drifting source of truth for who is a member.
  // The calling service, which already knows, expands it.
  recipients: z.array(z.string().uuid()).min(1).max(1000),
  type: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  category: categorySchema.optional(),
  severity: severitySchema.optional(),
  organizationId: z.string().uuid().optional(),
  appId: z.string().uuid().optional(),
  actionUrl: z.string().max(500).optional(),
  actionLabel: z.string().max(80).optional(),
  data: z.record(z.unknown()).optional(),
  /** Suffixed per recipient, so one producer key deduplicates across the fan-out. */
  dedupeKey: z.string().max(150).optional(),
  expiresAt: z.string().datetime().optional(),
});

export function createNotificationRouter(
  deps: NotificationRouterDeps
): express.Router {
  const router = express.Router();
  const { notifications, preferences, hub } = deps;

  // ── internal (service-to-service) ────────────────────────────────────────
  // Mounted BEFORE the user-facing routes so `/internal/publish` cannot be
  // captured by the `/:id` patterns below.
  router.post(
    '/internal/publish',
    requireInternalToken,
    async (req: Request, res: Response) => {
      const parsed = publishSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const input = parsed.data;

      const created: string[] = [];
      let deduped = 0;
      let suppressed = 0;

      for (const userId of input.recipients) {
        const category = (input.category ?? 'system') as NotificationCategory;

        // Respect the recipient's opt-out. Security in-app is immutable, so an
        // account-safety alert is always delivered (see preferences.isMutable).
        const wants = await preferences.isEnabled(userId, category, 'in_app');
        if (!wants) {
          suppressed += 1;
          continue;
        }

        const notification = await notifications.create({
          userId,
          organizationId: input.organizationId ?? null,
          appId: input.appId ?? null,
          type: input.type,
          category,
          severity: input.severity,
          title: input.title,
          body: input.body ?? null,
          actionUrl: input.actionUrl ?? null,
          actionLabel: input.actionLabel ?? null,
          data: input.data,
          // Per-recipient so the SAME producer key deduplicates each person's
          // copy independently — a shared key would let the first recipient's
          // row suppress everyone else's.
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : null,
          expiresAt: input.expiresAt ?? null,
        });

        if (!notification) {
          deduped += 1;
          continue;
        }

        created.push(notification.id);
        // Live push is best-effort; the row is already durable.
        hub.publish(userId, notification);
      }

      res.status(201).json({
        created: created.length,
        deduped,
        suppressed,
        ids: created,
      });
    }
  );

  // ── SSE stream ───────────────────────────────────────────────────────────
  // Declared before `/:id` so the literal path wins.
  router.get('/stream', authenticateToken, (req: Request, res: Response) => {
    const userId = req.userId as string;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which holds every event
      // until the buffer fills — indistinguishable from a dead stream.
      'X-Accel-Buffering': 'no',
    });

    const client = hub.add(userId, res);
    if (!client) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: 'too_many_streams' })}\n\n`
      );
      res.end();
      return;
    }

    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    req.on('close', () => hub.remove(client));
  });

  // ── unread count ─────────────────────────────────────────────────────────
  router.get('/unread-count', authenticateToken, async (req, res) => {
    const organizationId =
      typeof req.query.organizationId === 'string'
        ? req.query.organizationId
        : undefined;
    const unread = await notifications.unreadCount(
      req.userId as string,
      organizationId
    );
    res.json({ unread });
  });

  // ── preferences ──────────────────────────────────────────────────────────
  router.get('/preferences', authenticateToken, async (req, res) => {
    res.json({ preferences: await preferences.get(req.userId as string) });
  });

  router.put('/preferences', authenticateToken, async (req, res) => {
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const updated = await preferences.set(
      req.userId as string,
      parsed.data.preferences as Array<{
        category: NotificationCategory;
        channel: NotificationChannel;
        enabled: boolean;
      }>
    );
    res.json({ preferences: updated });
  });

  // ── bulk state changes ───────────────────────────────────────────────────
  router.post('/read-all', authenticateToken, async (req, res) => {
    const parsed = scopeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const updated = await notifications.markAllRead(
      req.userId as string,
      parsed.data.organizationId
    );
    res.json({ updated });
  });

  router.post('/seen', authenticateToken, async (req, res) => {
    const parsed = scopeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const updated = await notifications.markAllSeen(
      req.userId as string,
      parsed.data.organizationId
    );
    res.json({ updated });
  });

  // ── inbox ────────────────────────────────────────────────────────────────
  router.get('/', authenticateToken, async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const page = await notifications.list({
      userId: req.userId as string,
      organizationId: parsed.data.organizationId,
      category: parsed.data.category,
      status: parsed.data.status ?? 'all',
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      cursor: parsed.data.cursor,
    });

    res.json(page);
  });

  // ── per-item state ───────────────────────────────────────────────────────
  router.post('/:id/read', authenticateToken, async (req, res) => {
    const ok = await notifications.markRead(req.userId as string, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  });

  router.post('/:id/unread', authenticateToken, async (req, res) => {
    const ok = await notifications.markUnread(
      req.userId as string,
      req.params.id
    );
    if (!ok) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  });

  router.delete('/:id', authenticateToken, async (req, res) => {
    const ok = await notifications.archive(req.userId as string, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  });

  return router;
}
