import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ConversationWithMessages } from '@fuzefront/chat-client';
import { useChat } from '../src/hooks/useChat';
import { makeFakeClient } from './fakeClient';

const CONV = {
  id: 'conv-1',
  title: null,
  appId: 'mendys',
  orgId: 'org1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
};

function page(
  ids: string[],
  { hasMoreBefore = false, hasMoreAfter = false } = {},
): ConversationWithMessages {
  return {
    ...CONV,
    messages: ids.map((id, i) => ({
      id,
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: { type: 'text', text: `text-${id}` },
      createdAt: `2026-01-0${i + 1}`,
    })),
    hasMoreBefore,
    hasMoreAfter,
  };
}

describe('useChat', () => {
  it('streams a turn: user message, accumulated assistant text, done', async () => {
    const { client } = makeFakeClient([
      { type: 'rag_sources', sources: [{ title: 'T', url: 'https://u', excerpt: 'e' }] },
      { type: 'text_delta', delta: 'Hel' },
      { type: 'text_delta', delta: 'lo' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', resume: false }));

    await act(async () => {
      await result.current.send('hi there');
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi there' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello' });
    expect(result.current.messages[1].sources).toHaveLength(1);
  });

  it('ignores empty sends', async () => {
    const { client } = makeFakeClient([{ type: 'done' }]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', resume: false }));
    await act(async () => {
      await result.current.send('   ');
    });
    expect(result.current.messages).toHaveLength(0);
  });

  it('confirm() approves a pending tool and records the call', async () => {
    const { client, confirmCalls } = makeFakeClient([
      { type: 'tool_pending', confirmationId: 'c1', toolName: 'create_org', args: {}, description: 'd' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', resume: false }));
    await act(async () => {
      await result.current.send('make an org');
    });
    await act(async () => {
      await result.current.confirm('c1');
    });
    expect(confirmCalls).toEqual(['c1']);
    const conf = result.current.messages[1].confirmations![0];
    expect(conf.status).toBe('approved');
  });

  it('confirm() marks denied + surfaces error when the request throws', async () => {
    let captured = '';
    const { client } = makeFakeClient(
      [
        { type: 'tool_pending', confirmationId: 'c1', toolName: 't', args: {}, description: 'd' },
        { type: 'done' },
      ],
      { confirmThrows: true },
    );
    const { result } = renderHook(() =>
      useChat({ client, orgId: 'org1', resume: false, onError: (m) => (captured = m) }),
    );
    await act(async () => {
      await result.current.send('x');
    });
    await act(async () => {
      await result.current.confirm('c1');
    });
    expect(result.current.messages[1].confirmations![0].status).toBe('denied');
    expect(captured).toBe('PDP denied');
  });

  it('feedback() optimistically sets state and calls the client', async () => {
    const { client, feedbackCalls } = makeFakeClient([
      { type: 'text_delta', delta: 'hey' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', resume: false }));
    await act(async () => {
      await result.current.send('hi');
    });
    const assistantId = result.current.messages[1].id;
    await act(async () => {
      await result.current.feedback(assistantId, 'positive');
    });
    expect(feedbackCalls).toEqual([{ messageId: assistantId, rating: 'positive' }]);
    expect(result.current.messages[1].feedback).toBe('positive');
  });

  it('surfaces a terminal error event via onError', async () => {
    let captured = '';
    const { client } = makeFakeClient([{ type: 'error', message: 'stream failed' }]);
    const { result } = renderHook(() =>
      useChat({ client, orgId: 'org1', resume: false, onError: (m) => (captured = m) }),
    );
    await act(async () => {
      await result.current.send('hi');
    });
    expect(captured).toBe('stream failed');
    expect(result.current.messages[1].error).toBe('stream failed');
  });

  it('adopts the server-announced conversation id for follow-up sends', async () => {
    const { client, streamRequests } = makeFakeClient([
      { type: 'conversation', conversationId: 'conv-9' },
      { type: 'text_delta', delta: 'ok' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', resume: false }));
    await act(async () => {
      await result.current.send('first');
    });
    expect(result.current.conversationId).toBe('conv-9');
    await act(async () => {
      await result.current.send('second');
    });
    expect(streamRequests[0].conversationId).toBeUndefined();
    expect(streamRequests[1].conversationId).toBe('conv-9');
  });

  it('hydrates the most recent conversation for the (org, app) scope on mount', async () => {
    const { client, listCalls, getCalls, streamRequests } = makeFakeClient(
      [{ type: 'text_delta', delta: 'ok' }, { type: 'done' }],
      {
        conversations: [CONV],
        pages: [page(['m1', 'm2'], { hasMoreBefore: true })],
      },
    );
    const { result } = renderHook(() =>
      useChat({ client, orgId: 'org1', appId: 'mendys', pageSize: 2 }),
    );

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    expect(listCalls[0]).toEqual({ appId: 'mendys', orgId: 'org1' });
    expect(getCalls[0]).toEqual({ id: 'conv-1', options: { limit: 2 } });
    expect(result.current.conversationId).toBe('conv-1');
    expect(result.current.messages.map((m) => m.content)).toEqual(['text-m1', 'text-m2']);
    expect(result.current.hasMoreBefore).toBe(true);

    // A follow-up send continues the resumed thread with the loaded context.
    await act(async () => {
      await result.current.send('and then?');
    });
    expect(streamRequests[0].conversationId).toBe('conv-1');
    expect(streamRequests[0].appId).toBe('mendys');
    expect(streamRequests[0].messages.map((m) => m.content)).toEqual([
      'text-m1',
      'text-m2',
      'and then?',
    ]);
  });

  it('starts empty when the scope has no conversations yet', async () => {
    const { client } = makeFakeClient([{ type: 'done' }], { conversations: [] });
    const { result } = renderHook(() => useChat({ client, orgId: 'org1', appId: 'mendys' }));
    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.hasMoreBefore).toBe(false);
  });

  it('loadOlder pages backwards with a before-cursor and prepends', async () => {
    const { client, getCalls } = makeFakeClient([{ type: 'done' }], {
      conversations: [CONV],
      pages: [
        page(['m3', 'm4'], { hasMoreBefore: true }),
        { ...page(['m1', 'm2']), hasMoreBefore: false, hasMoreAfter: true },
      ],
    });
    const { result } = renderHook(() =>
      useChat({ client, orgId: 'org1', appId: 'mendys', pageSize: 2 }),
    );
    await waitFor(() => expect(result.current.hasMoreBefore).toBe(true));

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(getCalls[1]).toEqual({ id: 'conv-1', options: { before: 'm3', limit: 2 } });
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(result.current.hasMoreBefore).toBe(false);

    // Cursor moved to the new oldest edge for the next page.
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(getCalls[2]).toEqual({ id: 'conv-1', options: { before: 'm1', limit: 2 } });
  });

  it('re-hydrating on a scope change replaces the previous scope entirely', async () => {
    const { client, streamRequests } = makeFakeClient(
      [{ type: 'text_delta', delta: 'ok' }, { type: 'done' }],
      {
        conversations: [CONV],
        pages: [page(['m1', 'm2']), page(['m3', 'm4'])],
      },
    );
    const { result, rerender } = renderHook(
      ({ orgId }) => useChat({ client, orgId, appId: 'mendys', pageSize: 2 }),
      { initialProps: { orgId: 'org1' } },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    rerender({ orgId: 'org2' });
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual(['m3', 'm4']),
    );

    // The old scope's history must not leak into the next request payload.
    await act(async () => {
      await result.current.send('hello');
    });
    expect(streamRequests[0].messages.map((m) => m.content)).toEqual([
      'text-m3',
      'text-m4',
      'hello',
    ]);
  });

  it('loadNewer pages forwards with an after-cursor and appends', async () => {
    const { client, getCalls } = makeFakeClient([{ type: 'done' }], {
      conversations: [CONV],
      pages: [
        page(['m1', 'm2'], { hasMoreAfter: true }),
        page(['m3', 'm4'], { hasMoreAfter: false }),
      ],
    });
    const { result } = renderHook(() =>
      useChat({ client, orgId: 'org1', appId: 'mendys', pageSize: 2 }),
    );
    await waitFor(() => expect(result.current.hasMoreAfter).toBe(true));

    await act(async () => {
      await result.current.loadNewer();
    });

    expect(getCalls[1]).toEqual({ id: 'conv-1', options: { after: 'm2', limit: 2 } });
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(result.current.hasMoreAfter).toBe(false);
  });
});
