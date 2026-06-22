import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from '../src/hooks/useChat';
import { makeFakeClient } from './fakeClient';

describe('useChat', () => {
  it('streams a turn: user message, accumulated assistant text, done', async () => {
    const { client } = makeFakeClient([
      { type: 'rag_sources', sources: [{ title: 'T', url: 'https://u', excerpt: 'e' }] },
      { type: 'text_delta', delta: 'Hel' },
      { type: 'text_delta', delta: 'lo' },
      { type: 'done' },
    ]);
    const { result } = renderHook(() => useChat({ client, orgId: 'org1' }));

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
    const { result } = renderHook(() => useChat({ client, orgId: 'org1' }));
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
    const { result } = renderHook(() => useChat({ client, orgId: 'org1' }));
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
      useChat({ client, orgId: 'org1', onError: (m) => (captured = m) }),
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
    const { result } = renderHook(() => useChat({ client, orgId: 'org1' }));
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
      useChat({ client, orgId: 'org1', onError: (m) => (captured = m) }),
    );
    await act(async () => {
      await result.current.send('hi');
    });
    expect(captured).toBe('stream failed');
    expect(result.current.messages[1].error).toBe('stream failed');
  });
});
