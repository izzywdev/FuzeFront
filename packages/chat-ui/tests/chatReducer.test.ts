import { describe, it, expect } from 'vitest';
import { chatReducer, initialModel, type ChatModel } from '../src/hooks/chatReducer';

function withTurn(): ChatModel {
  let s = chatReducer(initialModel, { kind: 'user_message', id: 'u1', content: 'hi' });
  s = chatReducer(s, { kind: 'assistant_start', id: 'a1' });
  return s;
}

describe('chatReducer', () => {
  it('appends a user message', () => {
    const s = chatReducer(initialModel, { kind: 'user_message', id: 'u1', content: 'hello' });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: 'user', content: 'hello', streaming: false });
  });

  it('starts a streaming assistant message', () => {
    const s = withTurn();
    expect(s.streaming).toBe(true);
    expect(s.messages[1]).toMatchObject({ role: 'assistant', content: '', streaming: true });
  });

  it('accumulates text_delta into the assistant message', () => {
    let s = withTurn();
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'text_delta', delta: 'Hel' } });
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'text_delta', delta: 'lo' } });
    expect(s.messages[1].content).toBe('Hello');
  });

  it('attaches rag_sources to the assistant message', () => {
    let s = withTurn();
    const sources = [{ title: 'Doc', url: 'https://x/y', excerpt: 'e' }];
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'rag_sources', sources } });
    expect(s.messages[1].sources).toEqual(sources);
  });

  it('adds a pending confirmation on tool_pending', () => {
    let s = withTurn();
    s = chatReducer(s, {
      kind: 'stream_event',
      event: {
        type: 'tool_pending',
        confirmationId: 'c1',
        toolName: 'create_org',
        args: { name: 'Acme' },
        description: 'Create organization Acme',
      },
    });
    expect(s.messages[1].confirmations).toHaveLength(1);
    expect(s.messages[1].confirmations![0]).toMatchObject({
      confirmationId: 'c1',
      toolName: 'create_org',
      status: 'pending',
    });
  });

  it('resolves a confirmation on tool_result success', () => {
    let s = withTurn();
    s = chatReducer(s, {
      kind: 'stream_event',
      event: { type: 'tool_pending', confirmationId: 'c1', toolName: 't', args: {}, description: 'd' },
    });
    s = chatReducer(s, {
      kind: 'stream_event',
      event: { type: 'tool_result', confirmationId: 'c1', success: true, summary: 'Created.' },
    });
    expect(s.messages[1].confirmations![0]).toMatchObject({ status: 'approved', summary: 'Created.' });
  });

  it('marks a pending confirmation denied on tool_denied (by tool name)', () => {
    let s = withTurn();
    s = chatReducer(s, {
      kind: 'stream_event',
      event: { type: 'tool_pending', confirmationId: 'c1', toolName: 'create_org', args: {}, description: 'd' },
    });
    s = chatReducer(s, {
      kind: 'stream_event',
      event: { type: 'tool_denied', toolName: 'create_org', reason: 'no permission' },
    });
    expect(s.messages[1].confirmations![0]).toMatchObject({ status: 'denied', summary: 'no permission' });
  });

  it('sets error and stops streaming on error', () => {
    let s = withTurn();
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'error', message: 'boom' } });
    expect(s.streaming).toBe(false);
    expect(s.messages[1]).toMatchObject({ error: 'boom', streaming: false });
  });

  it('stops streaming on done', () => {
    let s = withTurn();
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'text_delta', delta: 'x' } });
    s = chatReducer(s, { kind: 'stream_event', event: { type: 'done' } });
    expect(s.streaming).toBe(false);
    expect(s.messages[1].streaming).toBe(false);
  });

  it('records feedback against a message id', () => {
    let s = withTurn();
    s = chatReducer(s, { kind: 'set_feedback', id: 'a1', feedback: 'positive' });
    expect(s.messages[1].feedback).toBe('positive');
  });

  it('reset clears everything', () => {
    let s = withTurn();
    s = chatReducer(s, { kind: 'reset' });
    expect(s).toEqual(initialModel);
  });
});
