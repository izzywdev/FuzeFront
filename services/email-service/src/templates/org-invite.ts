import { TemplateResult } from './index';

export function renderOrgInvite(vars: Record<string, unknown>): TemplateResult {
  const orgName = String(vars.orgName || 'your organization');
  const inviteUrl = String(vars.inviteUrl || '#');
  const inviterName = String(vars.inviterName || 'A colleague');
  return {
    subject: `You've been invited to ${orgName} on FuzeFront`,
    html: `<h1>You're invited!</h1><p>${inviterName} has invited you to join <strong>${orgName}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
    text: `You're invited!\n\n${inviterName} has invited you to join ${orgName}.\n\nAccept: ${inviteUrl}`,
  };
}
