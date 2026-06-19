"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProvider = void 0;
const sendgrid_1 = require("./sendgrid");
const smtp_1 = require("./smtp");
function createProvider(config) {
    if (config.email.provider === 'sendgrid') {
        if (!config.email.sendgridApiKey) {
            throw new Error('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid');
        }
        return new sendgrid_1.SendGridProvider(config.email.sendgridApiKey, config.email.from);
    }
    if (!config.email.smtp) {
        throw new Error('SMTP config is required when EMAIL_PROVIDER=smtp');
    }
    return new smtp_1.SmtpProvider(config.email.smtp);
}
exports.createProvider = createProvider;
//# sourceMappingURL=index.js.map