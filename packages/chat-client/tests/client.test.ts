/**
 * Unit tests for ChatServiceClient (client.ts).
 *
 * `fetch` is mocked globally via jest.fn() so no network I/O occurs.
 * The real SSE parser is used (no double-mocking of your own code).
 */

import { ChatServiceClient } from '../src/client';
import type { ChatStreamEvent } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fetch-compatible Response for JSON endpoints. */
function makeJsonResponse(body: unknown, status = 200): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a ReadableStream that emits SSE text for streamChat tests. */
function makeSseStream(sseText: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sseText);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Build a streaming Response from SSE text. */
function makeSseResponse(sseText: string, status = 200): Response {
  return new Response(makeSseStream(sseText), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Serialize an SSE event line. */
function sseEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// streamChat
// ---------------------------------------------------------------------------

describe('ChatServiceClient.streamChat', () => {
  it('sends POST /chat/stream with Authorization header and correct body', async () => {
    const sseText =
      sseEvent({ type: 'text_delta', delta: 'Hi' }) + sseEvent({ type: 'done' });

    mockFetch.mockResolvedValueOnce(makeSseResponse(sseText));

    const client = new ChatServiceClient({
      baseUrl: 'https://chat.example.com',
      getToken: () => 'tok-abc',
    });

    const events: ChatStreamEvent[] = [];
    for await (const evt of client.streamChat({
      messages: [{ role: 'user', content: 'Hello' }],
      orgId: 'org1',
    })) {
      events.push(evt);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chat.example.com/chat/stream');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-abc');

    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.orgId).toBe('org1');
    expect(parsedBody.messages[0].content).toBe('Hello');

    expect(events[0]).toEqual({ type: 'text_delta', delta: 'Hi' });
    expect(events[1]).toEqual({ type: 'done' });
  });

  it('yields parsed events from the SSE stream', async () => {
    const sseText =
      sseEvent({ type: 'text_delta', delta: 'chunk1' }) +
      sseEvent({ type: 'text_delta', delta: 'chunk2' }) +
      sseEvent({ type: 'done' });

    mockFetch.mockResolvedValueOnce(makeSseResponse(sseText));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'token',
    });

    const events: ChatStreamEvent[] = [];
    for await (const evt of client.streamChat({ messages: [], orgId: 'org1' })) {
      events.push(evt);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'text_delta', delta: 'chunk1' });
    expect(events[1]).toEqual({ type: 'text_delta', delta: 'chunk2' });
    expect(events[2]).toEqual({ type: 'done' });
  });

  it('yields an error event on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'token',
    });

    const events: ChatStreamEvent[] = [];
    for await (const evt of client.streamChat({ messages: [], orgId: 'org1' })) {
      events.push(evt);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as Extract<ChatStreamEvent, { type: 'error' }>).message).toMatch('403');
  });

  it('yields an error event on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'token',
    });

    const events: ChatStreamEvent[] = [];
    for await (const evt of client.streamChat({ messages: [], orgId: 'org1' })) {
      events.push(evt);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('does not send Authorization header when getToken returns null', async () => {
    const sseText = sseEvent({ type: 'done' });
    mockFetch.mockResolvedValueOnce(makeSseResponse(sseText));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => null,
    });

    for await (const _ of client.streamChat({ messages: [], orgId: 'org1' })) {
      // drain
    }

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('includes conversationId in the request body when provided', async () => {
    const sseText = sseEvent({ type: 'done' });
    mockFetch.mockResolvedValueOnce(makeSseResponse(sseText));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'token',
    });

    for await (const _ of client.streamChat({
      messages: [],
      orgId: 'org1',
      conversationId: 'conv-xyz',
    })) {
      // drain
    }

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.conversationId).toBe('conv-xyz');
  });
});

// ---------------------------------------------------------------------------
// confirmTool
// ---------------------------------------------------------------------------

describe('ChatServiceClient.confirmTool', () => {
  it('sends POST /chat/confirm/:id with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'tok123',
    });

    await client.confirmTool('cid-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/chat/confirm/cid-1');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('throws on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'token',
    });

    await expect(client.confirmTool('cid-1')).rejects.toThrow('401');
  });
});

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe('ChatServiceClient.listConversations', () => {
  it('sends GET /chat/conversations with Authorization header', async () => {
    const mockData = [{ id: 'conv1', title: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' }];
    mockFetch.mockResolvedValueOnce(makeJsonResponse(mockData));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'tok',
    });

    const result = await client.listConversations();

    expect(result).toEqual(mockData);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/chat/conversations');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('throws on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => null,
    });

    await expect(client.listConversations()).rejects.toThrow('401');
  });
});

// ---------------------------------------------------------------------------
// getConversation
// ---------------------------------------------------------------------------

describe('ChatServiceClient.getConversation', () => {
  it('sends GET /chat/conversations/:id with Authorization header', async () => {
    const mockData = {
      id: 'conv1',
      title: 'Test',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      messages: [],
    };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(mockData));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'tok',
    });

    const result = await client.getConversation('conv1');

    expect(result).toEqual(mockData);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/chat/conversations/conv1');
  });

  it('throws on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => null,
    });

    await expect(client.getConversation('conv1')).rejects.toThrow('401');
  });
});

// ---------------------------------------------------------------------------
// submitFeedback
// ---------------------------------------------------------------------------

describe('ChatServiceClient.submitFeedback', () => {
  it('sends POST /chat/feedback with correct body and Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'tok',
    });

    await client.submitFeedback('msg-1', 'positive');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/chat/feedback');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ messageId: 'msg-1', rating: 'positive' });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

    const client = new ChatServiceClient({
      baseUrl: 'http://localhost:3000',
      getToken: () => 'tok',
    });

    await expect(client.submitFeedback('msg-1', 'negative')).rejects.toThrow('500');
  });
});
