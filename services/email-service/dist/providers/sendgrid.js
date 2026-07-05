"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendGridProvider = void 0;
const mail_1 = __importDefault(require("@sendgrid/mail"));
class SendGridProvider {
    constructor(apiKey, defaultFrom) {
        mail_1.default.setApiKey(apiKey);
        this.defaultFrom = defaultFrom;
    }
    async send(msg) {
        const [response] = await mail_1.default.send({
            to: msg.to,
            from: msg.from || this.defaultFrom,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
        });
        return { messageId: response.headers['x-message-id'] };
    }
}
exports.SendGridProvider = SendGridProvider;
//# sourceMappingURL=sendgrid.js.map