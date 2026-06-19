import { TemplateResult } from './index';
import { escapeHtml, validateAndEscapeUrl } from '../utils/html';

export function renderWelcome(vars: Record<string, unknown>): TemplateResult {
  const firstName = String(vars.firstName || 'there');
  const loginUrl = String(vars.loginUrl || 'https://app.fuzefront.com');

  const safeFirstName = escapeHtml(firstName);
  const safeLoginUrl = validateAndEscapeUrl(loginUrl);

  return {
    subject: `Welcome to FuzeFront, ${safeFirstName}!`,
    html: `<h1>Welcome, ${safeFirstName}!</h1><p>Your FuzeFront account is ready.</p><p><a href="${safeLoginUrl}">Log in now</a></p>`,
    text: `Welcome, ${firstName}!\n\nYour FuzeFront account is ready.\n\nLog in: ${loginUrl}`,
  };
}
