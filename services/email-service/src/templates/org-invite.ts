import { TemplateResult } from './index';
import { escapeHtml, validateAndEscapeUrl } from '../utils/html';

export function renderOrgInvite(vars: Record<string, unknown>): TemplateResult {
  const orgName = String(vars.orgName || 'your organization');
  const inviteUrl = String(vars.inviteUrl || '#');
  const inviterName = String(vars.inviterName || 'A colleague');

  const safeOrgName = escapeHtml(orgName);
  const safeInviterName = escapeHtml(inviterName);
  const safeInviteUrl = validateAndEscapeUrl(inviteUrl);

  return {
    subject: `You've been invited to ${safeOrgName} on FuzeFront`,
    html: `<h1>You&#x27;re invited!</h1><p>${safeInviterName} has invited you to join <strong>${safeOrgName}</strong>.</p><p><a href="${safeInviteUrl}">Accept invitation</a></p>`,
    text: `You're invited!\n\n${inviterName} has invited you to join ${orgName}.\n\nAccept: ${inviteUrl}`,
  };
}
