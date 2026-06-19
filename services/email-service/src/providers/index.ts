import { Config } from '../config';
import { EmailProvider } from './types';
import { SendGridProvider } from './sendgrid';
import { SmtpProvider } from './smtp';

export { EmailProvider, EmailMessage, SendResult } from './types';

export function createProvider(config: Config): EmailProvider {
  if (config.email.provider === 'sendgrid') {
    if (!config.email.sendgridApiKey) {
      throw new Error('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid');
    }
    return new SendGridProvider(config.email.sendgridApiKey);
  }
  if (!config.email.smtp) {
    throw new Error('SMTP config is required when EMAIL_PROVIDER=smtp');
  }
  return new SmtpProvider(config.email.smtp);
}
