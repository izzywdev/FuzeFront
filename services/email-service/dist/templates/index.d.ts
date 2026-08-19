import { SUPPORTED_TEMPLATES } from '@fuzefront/shared';
export interface TemplateResult {
    subject: string;
    html: string;
    text: string;
}
type SupportedTemplate = (typeof SUPPORTED_TEMPLATES)[number];
export declare function renderTemplate(name: SupportedTemplate, vars: Record<string, unknown>): TemplateResult;
export {};
//# sourceMappingURL=index.d.ts.map