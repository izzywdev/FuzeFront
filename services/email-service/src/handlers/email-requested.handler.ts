import {
  FuzeEvent,
  NotifyEmailRequestedPayloadV1,
  NotifyEmailStatusPayloadV1,
  notifyEmailStatusSchemaV1,
  TOPICS,
  TypedProducer,
} from '@fuzefront/shared';
import { EmailProvider } from '../providers';
import { renderTemplate } from '../templates';

export interface HandlerDeps {
  provider: EmailProvider;
  statusProducer: Pick<TypedProducer, 'send'>;
  from: string;
}

export async function handleEmailRequested(
  event: FuzeEvent<NotifyEmailRequestedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { payload } = event;
  const { provider, statusProducer, from } = deps;

  let status: NotifyEmailStatusPayloadV1['status'] = 'sent';
  let error: string | undefined;
  let providerMessageId: string | undefined;

  try {
    const rendered = renderTemplate(payload.template, payload.vars);
    const result = await provider.send({
      to: payload.to,
      from,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    providerMessageId = result.messageId;
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    console.error(`[email-handler] Failed to send email to ${payload.to}:`, error);
  }

  const statusPayload: NotifyEmailStatusPayloadV1 = {
    correlationId: payload.correlationId,
    to: payload.to,
    template: payload.template,
    status,
    error,
    providerMessageId,
    attemptedAt: new Date().toISOString(),
  };

  await statusProducer.send(
    TOPICS.NOTIFY_EMAIL_STATUS,
    {
      version: '1.0',
      topic: TOPICS.NOTIFY_EMAIL_STATUS,
      correlationId: event.correlationId,
      occurredAt: new Date().toISOString(),
      payload: statusPayload,
    },
    notifyEmailStatusSchemaV1
  );
}
