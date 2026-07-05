import sgMail from '@sendgrid/mail';
import { EmailMessage, EmailProvider, SendResult } from './types';

export class SendGridProvider implements EmailProvider {
  private defaultFrom: string;

  constructor(apiKey: string, defaultFrom: string) {
    sgMail.setApiKey(apiKey);
    this.defaultFrom = defaultFrom;
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const [response] = await sgMail.send({
      to: msg.to,
      from: msg.from || this.defaultFrom,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { messageId: response.headers['x-message-id'] as string | undefined };
  }
}
