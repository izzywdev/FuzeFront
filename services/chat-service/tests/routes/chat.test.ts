// chat.test.ts — chat routes: SSE stream, conversations, feedback, confirm.
// All collaborators mocked; no live LLM/Chroma/Kafka/DB. JWT signed locally.

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createChatRouter } from '../../src/routes/chat';
import { CursorNotFoundError } from '../../src/db/repositories/messages';

const JWT_SECRET = 'test-secret';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';

function token(claims: Record<string, unknown> = {}) {
  return jwt.sign({ userId: USER_ID, orgId: ORG_ID, ...claims }, JWT_SECRET);
}

const CONVERSATION = {
  id: 'c1',
  title: 'T',
  appId: 'fuzefront',
  orgId: ORG_ID,
  createdAt: 'a',
  updatedAt: 'b',
};

function buildApp(overrides: any = {}) {
  process.env.JWT_SECRET = JWT_SECRET;

  const deps = {
    runAgentTurn: jest.fn(async (_input: any, cb: any) => {
      cb.emit({ type: 'rag_sources', sources: [{ title: 'README', url: 'u', excerpt: 'e' }] });
      cb.emit({ type: 'text_delta', delta: 'Hello' });
      cb.onUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
      cb.emit({ type: 'done' });
    }),
    conversations: {
      list: jest.fn().mockResolvedValue([CONVERSATION]),
      findById: jest.fn().mockResolvedValue(CONVERSATION),
      create: jest.fn().mockResolvedValue({ ...CONVERSATION, id: 'c-new', title: null }),
      getOrCreateContinuous: jest
        .fn()
        .mockResolvedValue({ ...CONVERSATION, id: 'c-new', title: null }),
      touch: jest.fn().mockResolvedValue(undefined),
    },
    messages: {
      append: jest.fn().mockResolvedValue({ id: 'm1' }),
      listPage: jest.fn().mockResolvedValue({
        messages: [{ id: 'm1', role: 'user', content: { type: 'text', text: 'hi' }, createdAt: 't' }],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
    },
    feedback: { submit: jest.fn().mockResolvedValue(undefined) },
    confirmations: {
      confirm: jest.fn().mockReturnValue({ userId: USER_ID, toolName: 't', args: {} }),
    },
    billing: { emitUsage: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  };

  const app = express();
  app.use(express.json());
  app.use('/chat', createChatRouter(deps));
  return { app, deps };
}

describe('POST /chat/stream', () => {
  it('401 without a token', async () => {
    const { app } = buildApp();
    await request(app).post('/chat/stream').send({ messages: [], orgId: ORG_ID }).expect(401);
  });

  it('200 streams SSE events ending in done and persists + bills', async () => {
    // @fuzequality api streamChat
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID });

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.status).toBe(200);
    expect(res.text).toContain('"type":"rag_sources"');
    expect(res.text).toContain('"type":"text_delta"');
    expect(res.text).toContain('"type":"done"');
    // persisted user + assistant message
    expect(deps.messages.append).toHaveBeenCalled();
    // billed
    expect(deps.billing.emitUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, orgId: ORG_ID, totalTokens: 2 }),
    );
  });

  it('resolves the continuous thread when none is supplied and announces its id first', async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID });
    expect(deps.conversations.getOrCreateContinuous).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, orgId: ORG_ID, appId: 'fuzefront' }),
    );
    // Resolved server-side, so a client that never echoes the id back must NOT
    // get a brand-new conversation per turn (#120).
    expect(deps.conversations.create).not.toHaveBeenCalled();
    const firstEvent = res.text.split('\n\n')[0];
    expect(firstEvent).toContain('"type":"conversation"');
    expect(firstEvent).toContain('"conversationId":"c-new"');
  });

  it('returns the SAME thread id across turns when the client never echoes it back', async () => {
    const { app, deps } = buildApp();
    const send = () =>
      request(app)
        .post('/chat/stream')
        .set('Authorization', `Bearer ${token()}`)
        .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID });

    const first = await send();
    const second = await send();
    const idOf = (res: any) => JSON.parse(res.text.split('\n\n')[0].slice('data: '.length));

    expect(idOf(first).conversationId).toBe(idOf(second).conversationId);
    expect(deps.conversations.getOrCreateContinuous).toHaveBeenCalledTimes(2);
  });

  it('scopes the continuous thread to the appId from the request body', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID, appId: 'mendys' });
    expect(deps.conversations.getOrCreateContinuous).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'mendys' }),
    );
  });

  it('prefers the JWT appId claim over the request body', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token({ appId: 'mendys' })}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID, appId: 'spoofed' });
    expect(deps.conversations.getOrCreateContinuous).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'mendys' }),
    );
  });

  it('reuses a supplied conversation only after verifying ownership', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID, conversationId: 'c1' });
    expect(deps.conversations.findById).toHaveBeenCalledWith('c1', USER_ID);
    expect(deps.conversations.create).not.toHaveBeenCalled();
    expect(deps.conversations.getOrCreateContinuous).not.toHaveBeenCalled();
  });

  it('streams an error (not a foreign write) for a conversation the caller does not own', async () => {
    const { app, deps } = buildApp({
      conversations: {
        findById: jest.fn().mockResolvedValue(null),
        list: jest.fn(),
        create: jest.fn(),
        getOrCreateContinuous: jest.fn(),
        touch: jest.fn(),
      },
    });
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], orgId: ORG_ID, conversationId: 'cx' });
    expect(res.text).toContain('"type":"error"');
    expect(deps.messages.append).not.toHaveBeenCalled();
    expect(deps.runAgentTurn).not.toHaveBeenCalled();
  });
});

describe('GET /chat/conversations', () => {
  it('200 lists the authenticated users conversations', async () => {
    // @fuzequality api listConversations
    const { app, deps } = buildApp();
    const res = await request(app)
      .get('/chat/conversations')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(deps.conversations.list).toHaveBeenCalledWith(USER_ID, {
      appId: undefined,
      orgId: undefined,
    });
    expect(res.body[0].id).toBe('c1');
  });

  it('narrows by appId/orgId query params', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get('/chat/conversations?appId=mendys&orgId=org-9')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(deps.conversations.list).toHaveBeenCalledWith(USER_ID, {
      appId: 'mendys',
      orgId: 'org-9',
    });
  });

  it('the JWT appId claim wins over the query param', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get('/chat/conversations?appId=spoofed')
      .set('Authorization', `Bearer ${token({ appId: 'mendys' })}`)
      .expect(200);
    expect(deps.conversations.list).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ appId: 'mendys' }),
    );
  });

  it('401 without a token', async () => {
    const { app } = buildApp();
    await request(app).get('/chat/conversations').expect(401);
  });
});

describe('GET /chat/conversations/:id', () => {
  it('200 returns the conversation with the newest message page by default', async () => {
    // @fuzequality api getConversation
    const { app, deps } = buildApp();
    const res = await request(app)
      .get('/chat/conversations/c1')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(deps.conversations.findById).toHaveBeenCalledWith('c1', USER_ID);
    expect(deps.messages.listPage).toHaveBeenCalledWith('c1', USER_ID, {
      before: undefined,
      after: undefined,
      limit: 50,
    });
    expect(res.body.id).toBe('c1');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.hasMoreBefore).toBe(false);
    expect(res.body.hasMoreAfter).toBe(false);
  });

  it('returns 401 when conversation lookup authentication is missing', async () => {
    // @fuzequality api getConversation
    const { app } = buildApp();
    await request(app).get('/chat/conversations/c1').expect(401);
  });

  it('does not perform an item lookup when the required id path parameter is missing', async () => {
    // @fuzequality api getConversation
    const { app } = buildApp();
    const res = await request(app)
      .get('/chat/conversations/')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('forwards before/limit cursors and clamps limit to 200', async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get('/chat/conversations/c1?before=m9&limit=999')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(deps.messages.listPage).toHaveBeenCalledWith('c1', USER_ID, {
      before: 'm9',
      after: undefined,
      limit: 200,
    });
  });

  it('400 when before and after are combined', async () => {
    const { app } = buildApp();
    await request(app)
      .get('/chat/conversations/c1?before=m1&after=m2')
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
  });

  it('400 on an unknown cursor id', async () => {
    const { app } = buildApp({
      messages: {
        append: jest.fn(),
        listPage: jest.fn().mockRejectedValue(new CursorNotFoundError('ghost')),
      },
    });
    await request(app)
      .get('/chat/conversations/c1?before=ghost')
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
  });

  it('404 when the conversation is not owned by the user', async () => {
    const { app } = buildApp({
      conversations: {
        findById: jest.fn().mockResolvedValue(null),
        list: jest.fn(),
        create: jest.fn(),
        getOrCreateContinuous: jest.fn(),
        touch: jest.fn(),
      },
    });
    await request(app)
      .get('/chat/conversations/c1')
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
  });
});

describe('POST /chat/feedback', () => {
  it('records feedback for the authenticated user', async () => {
    // @fuzequality api submitFeedback
    const { app, deps } = buildApp();
    await request(app)
      .post('/chat/feedback')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messageId: 'm1', rating: 'positive' })
      .expect(200);
    expect(deps.feedback.submit).toHaveBeenCalledWith('m1', USER_ID, 'positive');
  });

  it('returns 401 when feedback authentication is missing', async () => {
    // @fuzequality api submitFeedback
    const { app } = buildApp();
    await request(app)
      .post('/chat/feedback')
      .send({ messageId: 'm1', rating: 'positive' })
      .expect(401);
  });

  it('400 on an invalid rating', async () => {
    const { app } = buildApp();
    await request(app)
      .post('/chat/feedback')
      .set('Authorization', `Bearer ${token()}`)
      .send({ messageId: 'm1', rating: 'meh' })
      .expect(400);
  });
});

describe('POST /chat/confirm/:id', () => {
  it('confirms a pending tool for the authenticated user', async () => {
    // @fuzequality api confirmTool
    const { app, deps } = buildApp();
    await request(app)
      .post('/chat/confirm/conf-1')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(deps.confirmations.confirm).toHaveBeenCalledWith('conf-1', USER_ID);
  });

  it('returns 401 when confirmation authentication is missing', async () => {
    // @fuzequality api confirmTool
    const { app } = buildApp();
    await request(app).post('/chat/confirm/conf-1').expect(401);
  });

  it('does not confirm a tool when the required id path parameter is missing', async () => {
    // @fuzequality api confirmTool
    const { app } = buildApp();
    await request(app)
      .post('/chat/confirm/')
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
  });

  it('404 when the confirmation is unknown or not owned', async () => {
    const { app } = buildApp({
      confirmations: { confirm: jest.fn().mockReturnValue(null) },
    });
    await request(app)
      .post('/chat/confirm/conf-x')
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
  });
});
