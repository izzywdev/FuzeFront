import { SUPPORTED_TEMPLATES } from '@fuzefront/shared/kafka';
import { renderWelcome } from './welcome';
import { renderOrgInvite } from './org-invite';
import { renderMembershipChange } from './membership-change';

export interface TemplateResult {
  subject: string;
  html: string;
  text: string;
}

type SupportedTemplate = (typeof SUPPORTED_TEMPLATES)[number];

const renderers: Record<SupportedTemplate, (vars: Record<string, unknown>) => TemplateResult> = {
  welcome: renderWelcome,
  'org-invite': renderOrgInvite,
  'membership-change': renderMembershipChange,
};

export function renderTemplate(name: SupportedTemplate, vars: Record<string, unknown>): TemplateResult {
  const renderer = renderers[name];
  if (!renderer) {
    throw new Error(`Unknown template: ${name}`);
  }
  return renderer(vars);
}
