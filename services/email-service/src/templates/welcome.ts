import { TemplateResult } from './index';

export function renderWelcome(vars: Record<string, unknown>): TemplateResult {
  const firstName = String(vars.firstName || 'there');
  const loginUrl = String(vars.loginUrl || 'https://app.fuzefront.com');
  return {
    subject: `Welcome to FuzeFront, ${firstName}!`,
    html: `<h1>Welcome, ${firstName}!</h1><p>Your FuzeFront account is ready.</p><p><a href="${loginUrl}">Log in now</a></p>`,
    text: `Welcome, ${firstName}!\n\nYour FuzeFront account is ready.\n\nLog in: ${loginUrl}`,
  };
}
