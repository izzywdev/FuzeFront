"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderFuzePickerReply = void 0;
const html_1 = require("../utils/html");
function renderFuzePickerReply(vars) {
    const recipientName = String(vars.recipientName || 'A collaborator');
    const subjectRecipientName = recipientName.replace(/\r/g, ' ').replace(/\n/g, ' ');
    const message = String(vars.message || 'They replied to your mention.');
    const mentionsUrl = String(vars.mentionsUrl || '#');
    return {
        subject: `${subjectRecipientName} replied to your FuzePicker mention`,
        html: `<h1>New FuzePicker reply</h1><p><strong>${(0, html_1.escapeHtml)(recipientName)}</strong> replied:</p><blockquote>${(0, html_1.escapeHtml)(message)}</blockquote><p><a href="${(0, html_1.validateAndEscapeUrl)(mentionsUrl)}">Open FuzePicker</a></p>`,
        text: `${recipientName} replied to your FuzePicker mention.\n\n${message}\n\nOpen FuzePicker: ${mentionsUrl}`,
    };
}
exports.renderFuzePickerReply = renderFuzePickerReply;
//# sourceMappingURL=fuzepicker-reply.js.map