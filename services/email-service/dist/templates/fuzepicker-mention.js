"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderFuzePickerMention = void 0;
const html_1 = require("../utils/html");
function renderFuzePickerMention(vars) {
    const senderName = String(vars.senderName || 'A collaborator');
    const subjectSenderName = senderName.replace(/\r/g, ' ').replace(/\n/g, ' ');
    const message = String(vars.message || 'You were mentioned on a page.');
    const mentionUrl = String(vars.mentionUrl || '#');
    return {
        subject: `${subjectSenderName} mentioned you in FuzePicker`,
        html: `<h1>You were mentioned</h1><p><strong>${(0, html_1.escapeHtml)(senderName)}</strong> left you a note:</p><blockquote>${(0, html_1.escapeHtml)(message)}</blockquote><p><a href="${(0, html_1.validateAndEscapeUrl)(mentionUrl)}">Sign in or sign up to FuzeFront and open the mention</a></p>`,
        text: `${senderName} mentioned you in FuzePicker.\n\n${message}\n\nSign in or sign up and open it: ${mentionUrl}`,
    };
}
exports.renderFuzePickerMention = renderFuzePickerMention;
//# sourceMappingURL=fuzepicker-mention.js.map