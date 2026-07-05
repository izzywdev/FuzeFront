import { EmailMessage, EmailProvider, SendResult } from './types';
export declare class SendGridProvider implements EmailProvider {
    private defaultFrom;
    constructor(apiKey: string, defaultFrom: string);
    send(msg: EmailMessage): Promise<SendResult>;
}
//# sourceMappingURL=sendgrid.d.ts.map