import { injectRecentGmailSummary, isRecentGmailRequest } from '../../src/connectors/gmail-injection';

describe('Gmail chat injection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('recognizes the recent-email command', () => {
    expect(isRecentGmailRequest('Summarize my recent 5 emails in Gmail')).toBe(true);
    expect(isRecentGmailRequest('Explain Kafka partitions')).toBe(false);
  });

  it('persists before publishing ordered chunks', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        identity_email: 'owner@example.com',
        messages: [{ from: 'Alice <alice@example.com>', subject: 'Status', date: 'today', snippet: 'Everything is green.' }],
      }),
    } as Response);
    const append = jest.fn().mockResolvedValue({ id: 'message-1' });
    const touch = jest.fn().mockResolvedValue(undefined);
    const send = jest.fn().mockResolvedValue(undefined);

    await injectRecentGmailSummary({
      producer: { send }, messages: { append }, conversations: { touch },
      fuzefrontUrl: 'http://fuzefront-backend',
      workloadAuth: { getToken: jest.fn().mockResolvedValue('chat-workload-token'), invalidate: jest.fn() },
      delegation: { exchange: jest.fn().mockResolvedValue({ accessToken: 'delegation-token' }) },
    }, { userId: 'user-1', conversationId: 'conversation-1', userToken: 'user-token' });

    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: {
        Authorization: 'Bearer chat-workload-token',
        'X-Fuze-Delegation': 'Bearer delegation-token',
      },
    }));
    expect(append.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    const chunks = send.mock.calls.map(call => call[1].payload);
    expect(chunks[0]).toMatchObject({ type: 'start', sequence: 0, messageId: 'message-1' });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
    expect(chunks.filter(chunk => chunk.type === 'delta').map(chunk => chunk.delta).join(''))
      .toContain('**Status**');
  });
});
