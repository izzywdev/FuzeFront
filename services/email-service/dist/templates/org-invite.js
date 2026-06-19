"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOrgInvite = void 0;
const html_1 = require("../utils/html");
function renderOrgInvite(vars) {
    const orgName = String(vars.orgName || 'your organization');
    const inviteUrl = String(vars.inviteUrl || '#');
    const inviterName = String(vars.inviterName || 'A colleague');
    const safeOrgName = (0, html_1.escapeHtml)(orgName);
    const safeInviterName = (0, html_1.escapeHtml)(inviterName);
    const safeInviteUrl = (0, html_1.validateAndEscapeUrl)(inviteUrl);
    return {
        subject: `You've been invited to ${safeOrgName} on FuzeFront`,
        html: `<h1>You&#x27;re invited!</h1><p>${safeInviterName} has invited you to join <strong>${safeOrgName}</strong>.</p><p><a href="${safeInviteUrl}">Accept invitation</a></p>`,
        text: `You're invited!\n\n${inviterName} has invited you to join ${orgName}.\n\nAccept: ${inviteUrl}`,
    };
}
exports.renderOrgInvite = renderOrgInvite;
//# sourceMappingURL=org-invite.js.map