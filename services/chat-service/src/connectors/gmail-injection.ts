import { randomUUID } from 'crypto';
import {
  chatResponseChunkSchemaV1,
  TOPICS,
  type ChatResponseChunkPayloadV1,
  type FuzeEvent,
  type TypedProducer,
} from '@fuzefront/shared';
import type { MessagesRepository } from '../db/repositories/messages';
import type { ConversationsRepository } from '../db/repositories/conversations';

type GmailMessage = { from: string; subject: string; date: string; snippet: string };

export interface GmailInjectionDeps {
  producer: Pick<TypedProducer, 'send'>;
  messages: Pick<MessagesRepository, 'append'>;
  conversations: Pick<ConversationsRepository, 'touch'>;
  fuzekeysUrl: string;
  internalToken: string;
}

const RECENT_GMAIL = /\b(?:recent|latest|last)\s+(?:five|5)\s+(?:gmail|e-?mails?|messages?)\b|\b(?:gmail|e-?mails?)\b.*\b(?:recent|latest|last)\b/i;

export function isRecentGmailRequest(text: string): boolean {
  return RECENT_GMAIL.test(text);
}

function summarize(messages: GmailMessage[], identityEmail?: string): string {
  if (messages.length === 0) return 'There are no messages matching your Gmail connector query.';
  const heading = `Here are the ${messages.length} most recent emails${identityEmail ? ` for ${identityEmail}` : ''}:`;
  const items = messages.map((message, index) => {
    const snippet = message.snippet.trim().replace(/\s+/g, ' ').slice(0, 240);
    return `${index + 1}. **${message.subject || '(no subject)'}**\n   From: ${message.from || 'Unknown sender'}\n   ${snippet}`;
  });
  return [heading, '', ...items].join('\n');
}

export async function injectRecentGmailSummary(
  deps: GmailInjectionDeps,
  input: { userId: string; conversationId: string },
): Promise<void> {
  let text: string;
  try {
    if (!deps.internalToken) throw new Error('FuzeKeys connector integration is not configured');
    const response = await fetch(`${deps.fuzekeysUrl.replace(/\/+$/, '')}/api/v1/connectors/google-gmail/messages/recent?limit=5`, {
      headers: {
        'X-Fuze-User-Id': input.userId,
        'X-FuzeKeys-Internal-Token': deps.internalToken,
      },
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(errorPayload.detail || `Gmail connector returned HTTP ${response.status}`);
    }
    const payload = await response.json() as { identity_email?: string; messages: GmailMessage[] };
    text = summarize(payload.messages, payload.identity_email);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'connector unavailable';
    text = `I couldn't read your Gmail: ${reason}. Open **Connectors → Google Gmail** to connect or repair the account.`;
  }
  const stored = await deps.messages.append({
    conversationId: input.conversationId,
    role: 'assistant',
    content: { type: 'text', text },
  });
  await deps.conversations.touch(input.conversationId, input.userId);

  let sequence = 0;
  const publish = async (chunk: ChatResponseChunkPayloadV1) => {
    const event: FuzeEvent<ChatResponseChunkPayloadV1> = {
      version: '1.0',
      topic: TOPICS.CHAT_RESPONSE_CHUNK,
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: chunk,
    };
    await deps.producer.send(TOPICS.CHAT_RESPONSE_CHUNK, event, chatResponseChunkSchemaV1, { key: input.userId });
  };
  await publish({ userId: input.userId, conversationId: input.conversationId, messageId: stored.id, sequence: sequence++, type: 'start' });
  for (let offset = 0; offset < text.length; offset += 48) {
    await publish({ userId: input.userId, conversationId: input.conversationId, messageId: stored.id, sequence: sequence++, type: 'delta', delta: text.slice(offset, offset + 48) });
  }
  await publish({ userId: input.userId, conversationId: input.conversationId, messageId: stored.id, sequence, type: 'done' });
}
