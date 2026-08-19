import { EmailMessage, EmailProvider, SendResult } from './types';
import { Config } from '../config';
export declare class SmtpProvider implements EmailProvider {
    private transporter;
    constructor(smtpConfig: NonNullable<Config['email']['smtp']>);
    send(msg: EmailMessage): Promise<SendResult>;
}
//# sourceMappingURL=smtp.d.ts.map