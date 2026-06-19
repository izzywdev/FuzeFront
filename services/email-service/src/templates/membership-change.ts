import { TemplateResult } from './index';

export function renderMembershipChange(vars: Record<string, unknown>): TemplateResult {
  const orgName = String(vars.orgName || 'your organization');
  const action = String(vars.action || 'updated');
  const role = String(vars.role || 'member');
  return {
    subject: `Your membership in ${orgName} has been ${action}`,
    html: `<p>Your membership in <strong>${orgName}</strong> has been <strong>${action}</strong>. Your role is <strong>${role}</strong>.</p>`,
    text: `Your membership in ${orgName} has been ${action}. Your role is ${role}.`,
  };
}
