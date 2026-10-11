import { TemplateResult } from './index';
import { escapeHtml, validateAndEscapeUrl } from '../utils/html';

export function renderFuzePickerReply(vars: Record<string, unknown>): TemplateResult {
  const recipientName = String(vars.recipientName || 'A collaborator');
  const subjectRecipientName = recipientName.replace(/\r/g, ' ').replace(/\n/g, ' ');
  const message = String(vars.message || 'They replied to your mention.');
  const mentionsUrl = String(vars.mentionsUrl || '#');
  return {
    subject: `${subjectRecipientName} replied to your FuzePicker mention`,
    html: `<h1>New FuzePicker reply</h1><p><strong>${escapeHtml(recipientName)}</strong> replied:</p><blockquote>${escapeHtml(message)}</blockquote><p><a href="${validateAndEscapeUrl(mentionsUrl)}">Open FuzePicker</a></p>`,
    text: `${recipientName} replied to your FuzePicker mention.\n\n${message}\n\nOpen FuzePicker: ${mentionsUrl}`,
  };
}
