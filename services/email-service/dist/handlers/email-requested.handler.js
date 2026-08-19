"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEmailRequested = void 0;
const shared_1 = require("@fuzefront/shared");
const templates_1 = require("../templates");
const mask_1 = require("../utils/mask");
const provider_error_1 = require("../utils/provider-error");
const DEBUG = process.env.EMAIL_SERVICE_DEBUG === 'true';
async function handleEmailRequested(event, deps) {
    const { payload } = event;
    const { provider, statusProducer, from } = deps;
    let status = 'sent';
    let errorCode;
    let providerMessageId;
    try {
        const rendered = (0, templates_1.renderTemplate)(payload.template, payload.vars);
        const result = await provider.send({
            to: payload.to,
            from,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
        });
        providerMessageId = result.messageId;
        console.info(`[email-handler] Email sent to ${(0, mask_1.maskEmail)(payload.to)} (correlationId=${payload.correlationId})`);
    }
    catch (err) {
        status = 'failed';
        const rawMessage = err instanceof Error ? err.message : String(err);
        errorCode = (0, provider_error_1.classifyProviderError)(rawMessage);
        // Only log raw provider message in debug mode — keep it out of prod logs
        if (DEBUG) {
            console.debug(`[email-handler] Raw provider error for ${(0, mask_1.maskEmail)(payload.to)}: ${rawMessage}`);
        }
        console.error(`[email-handler] Failed to send email to ${(0, mask_1.maskEmail)(payload.to)} (correlationId=${payload.correlationId}): ${errorCode}`);
    }
    const statusPayload = {
        correlationId: payload.correlationId,
        to: payload.to,
        template: payload.template,
        status,
        // Emit stable code only — never the raw provider message
        error: errorCode,
        providerMessageId,
        attemptedAt: new Date().toISOString(),
    };
    await statusProducer.send(shared_1.TOPICS.NOTIFY_EMAIL_STATUS, {
        version: '1.0',
        topic: shared_1.TOPICS.NOTIFY_EMAIL_STATUS,
        correlationId: event.correlationId,
        occurredAt: new Date().toISOString(),
        payload: statusPayload,
    }, shared_1.notifyEmailStatusSchemaV1);
}
exports.handleEmailRequested = handleEmailRequested;
//# sourceMappingURL=email-requested.handler.js.map