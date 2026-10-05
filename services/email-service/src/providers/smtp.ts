import nodemailer from 'nodemailer';
// nodemailer >=10 ships its own TypeScript declarations, which take precedence
// over @types/nodemailer. Its default export is a plain value (no merged
// namespace), so `nodemailer.Transporter` no longer resolves as a type —
// import the named type export instead (also valid against @types/nodemailer).
import type { Transporter } from 'nodemailer';
import { EmailMessage, EmailProvider, SendResult } from './types';
import { Config } from '../config';

export class SmtpProvider implements EmailProvider {
  private transporter: Transporter;

  constructor(smtpConfig: NonNullable<Config['email']['smtp']>) {
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth:
        smtpConfig.user && smtpConfig.pass
          ? { user: smtpConfig.user, pass: smtpConfig.pass }
          : undefined,
    });
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { messageId: info.messageId };
  }
}
