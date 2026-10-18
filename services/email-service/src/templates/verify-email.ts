import { TemplateResult } from './index';
import { escapeHtml, validateAndEscapeUrl } from '../utils/html';
import { appBaseUrl } from '../utils/app-url';

/**
 * Email-ownership verification. `data.token` is the single-use link token and
 * `data.code` the 6-digit OTP (either redeems the challenge). The link lands on
 * the shell's `/verify/email` route.
 */
export function renderVerifyEmail(vars: Record<string, unknown>): TemplateResult {
  const token = String(vars.token || '');
  const code = String(vars.code || '');

  const link = token ? `${appBaseUrl(vars.appBaseUrl)}/verify/email?token=${encodeURIComponent(token)}` : '';
  const safeLink = link ? validateAndEscapeUrl(link) : '';
  const safeCode = escapeHtml(code);

  const htmlParts = ['<h1>Verify your email</h1>'];
  const textParts = ['Verify your email', ''];
  if (link) {
    htmlParts.push(`<p><a href="${safeLink}">Verify my email</a></p>`);
    textParts.push(`Verify: ${link}`, '');
  }
  if (code) {
    htmlParts.push(`<p>Or enter this code: <strong>${safeCode}</strong></p>`);
    textParts.push(`Or enter this code: ${code}`, '');
  }
  htmlParts.push('<p>This expires in 30 minutes. If you did not request it, ignore this email.</p>');
  textParts.push('This expires in 30 minutes. If you did not request it, ignore this email.');

  return {
    subject: 'Verify your FuzeFront email',
    html: htmlParts.join(''),
    text: textParts.join('\n'),
  };
}
