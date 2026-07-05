"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmtpProvider = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
class SmtpProvider {
    constructor(smtpConfig) {
        this.transporter = nodemailer_1.default.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure,
            auth: smtpConfig.user && smtpConfig.pass
                ? { user: smtpConfig.user, pass: smtpConfig.pass }
                : undefined,
        });
    }
    async send(msg) {
        const info = await this.transporter.sendMail({
            from: msg.from,
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
        });
        return { messageId: info.messageId };
    }
}
exports.SmtpProvider = SmtpProvider;
//# sourceMappingURL=smtp.js.map