import { TemplateResult } from './index';
import { escapeHtml, validateAndEscapeUrl } from '../utils/html';

export function renderFuzePickerMention(vars: Record<string, unknown>): TemplateResult {
  const senderName = String(vars.senderName || 'A collaborator');
  const subjectSenderName = senderName.replace(/\r/g, ' ').replace(/\n/g, ' ');
  const message = String(vars.message || 'You were mentioned on a page.');
  const mentionUrl = String(vars.mentionUrl || '#');

  return {
    subject: `${subjectSenderName} mentioned you in FuzePicker`,
    html: `<h1>You were mentioned</h1><p><strong>${escapeHtml(senderName)}</strong> left you a note:</p><blockquote>${escapeHtml(message)}</blockquote><p><a href="${validateAndEscapeUrl(mentionUrl)}">Sign in or sign up to FuzeFront and open the mention</a></p>`,
    text: `${senderName} mentioned you in FuzePicker.\n\n${message}\n\nSign in or sign up and open it: ${mentionUrl}`,
  };
}
