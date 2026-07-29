/**
 * Route-level tests for notification-service.
 *
 * The repositories are stubbed, so these run WITHOUT Postgres and assert the
 * wiring the API contract promises: that `user_id` always comes from the
 * verified token and never from the request, that `/internal/publish` fails
 * closed without a service token, and that read/seen stay distinct.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { NotificationsRepository } from '../src/db/repositories/notifications';
import { PreferencesRepository } from '../src/db/repositories/preferences';
import { StreamHub } from '../src/stream/hub';

const JWT_SECRET = 'test-secret-for-notification-service';
const INTERNAL_TOKEN = 'internal-test-token';

process.env.JWT_SECRET = JWT_SECRET;

function tokenFor(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET);
}

function stubRepos() {
  const notifications = {
    list: jest.fn().mockResolvedValue({ notifications: [], nextCursor: null }),
    unreadCount: jest.fn().mockResolvedValue(3),
    markRead: jest.fn().mockResolvedValue(true),
    markUnread: jest.fn().mockResolvedValue(true),
    markAllRead: jest.fn().mockResolvedValue(4),
    markAllSeen: jest.fn().mockResolvedValue(7),
    archive: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockImplementation(async (input: any) => ({
      id: `n-${input.userId}`,
      type: input.type,
      category: input.category ?? 'system',
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body ?? null,
      actionUrl: null,
      actionLabel: null,
      data: {},
      organizationId: input.organizationId ?? null,
      appId: null,
      readAt: null,
      seenAt: null,
      createdAt: new Date().toISOString(),
    })),
    purgeExpired: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<NotificationsRepository>;

  const preferences = {
    get: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockResolvedValue({}),
    isEnabled: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<PreferencesRepository>;

  return { notifications, preferences };
}

function build(overrides: { internalToken?: string | undefined } = {}) {
  if ('internalToken' in overrides) {
    if (overrides.internalToken === undefined) {
      delete process.env.NOTIFICATION_INTERNAL_TOKEN;
    } else {
      process.env.NOTIFICATION_INTERNAL_TOKEN = overrides.internalToken;
    }
  } else {
    process.env.NOTIFICATION_INTERNAL_TOKEN = INTERNAL_TOKEN;
  }

  const { notifications, preferences } = stubRepos();
  const hub = new StreamHub(60_000, 5);
  const app = createApp({ notifications: { notifications, preferences, hub } });
  return { app, notifications, preferences, hub };
}

describe('notification-service', () => {
  afterEach(() => {
    jest.clearAllMocks();
    process.env.NOTIFICATION_INTERNAL_TOKEN = INTERNAL_TOKEN;
  });

  describe('health', () => {
    it('is unauthenticated', async () => {
      const { app } = build();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'notification-service' });
    });
  });

  describe('authentication', () => {
    it('rejects an unauthenticated inbox read', async () => {
      const { app } = build();
      const res = await request(app).get('/notifications');
      expect(res.status).toBe(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const { app } = build();
      const forged = jwt.sign({ userId: 'user-x' }, 'not-the-secret');
      const res = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('derives the recipient from the TOKEN, never from the request', async () => {
      const { app, notifications } = build();

      // The query names a different user; it must be ignored entirely.
      await request(app)
        .get('/notifications?userId=someone-else')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      expect(notifications.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' })
      );
    });
  });

  describe('inbox', () => {
    it('returns a page', async () => {
      const { app } = build();
      const res = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ notifications: [], nextCursor: null });
    });

    it('rejects a limit above the ceiling', async () => {
      const { app } = build();
      const res = await request(app)
        .get('/notifications?limit=5000')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      expect(res.status).toBe(400);
    });

    it('answers the unread count', async () => {
      const { app } = build();
      const res = await request(app)
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unread: 3 });
    });

    it('404s a notification that is not the caller’s', async () => {
      const { app, notifications } = build();
      (notifications.markRead as jest.Mock).mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/notifications/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      expect(res.status).toBe(404);
    });

    it('keeps SEEN distinct from READ', async () => {
      const { app, notifications } = build();
      const auth = `Bearer ${tokenFor('user-1')}`;

      await request(app).post('/notifications/seen').set('Authorization', auth).send({});

      // Clearing the badge must NOT mark every item read — that would discard
      // the unread state the user opened the panel to act on.
      expect(notifications.markAllSeen).toHaveBeenCalledWith('user-1', undefined);
      expect(notifications.markAllRead).not.toHaveBeenCalled();
    });

    it('routes the literal /stream and /unread-count paths before /:id', async () => {
      const { app, notifications } = build();
      await request(app)
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`);

      // If /:id had won, markRead would have been reached with id='unread-count'.
      expect(notifications.markRead).not.toHaveBeenCalled();
      expect(notifications.unreadCount).toHaveBeenCalled();
    });
  });

  describe('internal publish', () => {
    const publishBody = {
      recipients: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      type: 'billing.invoice.paid',
      title: 'Invoice paid',
      category: 'billing',
    };

    it('is not reachable with a user JWT', async () => {
      const { app } = build();
      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${tokenFor('user-1')}`)
        .send(publishBody);

      expect(res.status).toBe(401);
    });

    it('fails CLOSED when no internal token is configured', async () => {
      const { app } = build({ internalToken: undefined });
      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', 'Bearer anything')
        .send(publishBody);

      // 503, not an open endpoint: an unauthenticated publish surface would let
      // anyone reaching the pod write into any inbox.
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('INTERNAL_TOKEN_UNSET');
    });

    it('fans one event out to every recipient', async () => {
      const { app, notifications } = build();
      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send(publishBody);

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(2);
      expect(notifications.create).toHaveBeenCalledTimes(2);
    });

    it('suffixes the dedupe key per recipient', async () => {
      const { app, notifications } = build();
      await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ ...publishBody, dedupeKey: 'invoice-42' });

      const keys = (notifications.create as jest.Mock).mock.calls.map(
        c => c[0].dedupeKey
      );
      // A shared key would let the first recipient's row suppress everyone else's.
      expect(new Set(keys).size).toBe(2);
      expect(keys[0]).toContain('invoice-42:');
    });

    it('counts a deduped recipient instead of failing the batch', async () => {
      const { app, notifications } = build();
      (notifications.create as jest.Mock).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ ...publishBody, dedupeKey: 'invoice-42' });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(1);
      expect(res.body.deduped).toBe(1);
    });

    it('skips a recipient who opted out of the category', async () => {
      const { app, notifications, preferences } = build();
      (preferences.isEnabled as jest.Mock).mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send(publishBody);

      expect(res.body.suppressed).toBe(1);
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty recipient list', async () => {
      const { app } = build();
      const res = await request(app)
        .post('/notifications/internal/publish')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ ...publishBody, recipients: [] });

      expect(res.status).toBe(400);
    });
  });
});
