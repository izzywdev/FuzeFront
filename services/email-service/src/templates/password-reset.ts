import { TemplateResult } from './index';
import { validateAndEscapeUrl } from '../utils/html';
import { appBaseUrl } from '../utils/app-url';

/** Self-service password reset. `data.token` is the single-use reset token. */
export function renderPasswordReset(vars: Record<string, unknown>): TemplateResult {
  const token = String(vars.token || '');
  const link = `${appBaseUrl(vars.appBaseUrl)}/reset?token=${encodeURIComponent(token)}`;
  const safeLink = validateAndEscapeUrl(link);

  return {
    subject: 'Reset your FuzeFront password',
    html: `<h1>Reset your password</h1><p><a href="${safeLink}">Choose a new password</a></p><p>This link expires in 30 minutes and works once. If you did not request a reset, ignore this email &mdash; your password has not changed.</p>`,
    text: `Reset your password\n\nChoose a new password: ${link}\n\nThis link expires in 30 minutes and works once. If you did not request a reset, ignore this email - your password has not changed.`,
  };
}
