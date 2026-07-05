export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
    from?: string;
}
export interface SendResult {
    messageId?: string;
}
export interface EmailProvider {
    send(msg: EmailMessage): Promise<SendResult>;
}
//# sourceMappingURL=types.d.ts.map