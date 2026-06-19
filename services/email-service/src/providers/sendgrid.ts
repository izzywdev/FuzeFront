import sgMail from '@sendgrid/mail';
import { EmailMessage, EmailProvider, SendResult } from './types';
import { Config } from '../config';

export class SendGridProvider implements EmailProvider {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey);
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const [response] = await sgMail.send({
      to: msg.to,
      from: msg.from || 'noreply@fuzefront.com',
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { messageId: response.headers['x-message-id'] as string | undefined };
  }
}
