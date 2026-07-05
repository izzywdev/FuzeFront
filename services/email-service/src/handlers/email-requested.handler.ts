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
import { maskEmail } from '../utils/mask';
import { classifyProviderError } from '../utils/provider-error';

export interface HandlerDeps {
  provider: EmailProvider;
  statusProducer: Pick<TypedProducer, 'send'>;
  from: string;
}

const DEBUG = process.env.EMAIL_SERVICE_DEBUG === 'true';

export async function handleEmailRequested(
  event: FuzeEvent<NotifyEmailRequestedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { payload } = event;
  const { provider, statusProducer, from } = deps;

  let status: NotifyEmailStatusPayloadV1['status'] = 'sent';
  let errorCode: string | undefined;
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
    console.info(`[email-handler] Email sent to ${maskEmail(payload.to)} (correlationId=${payload.correlationId})`);
  } catch (err) {
    status = 'failed';
    const rawMessage = err instanceof Error ? err.message : String(err);
    errorCode = classifyProviderError(rawMessage);
    // Only log raw provider message in debug mode — keep it out of prod logs
    if (DEBUG) {
      console.debug(`[email-handler] Raw provider error for ${maskEmail(payload.to)}: ${rawMessage}`);
    }
    console.error(
      `[email-handler] Failed to send email to ${maskEmail(payload.to)} (correlationId=${payload.correlationId}): ${errorCode}`
    );
  }

  const statusPayload: NotifyEmailStatusPayloadV1 = {
    correlationId: payload.correlationId,
    to: payload.to,
    template: payload.template,
    status,
    // Emit stable code only — never the raw provider message
    error: errorCode,
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
