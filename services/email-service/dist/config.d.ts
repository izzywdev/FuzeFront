export interface Config {
    port: number;
    kafka: {
        brokers: string[];
        clientId: string;
        groupId: string;
    };
    email: {
        provider: 'sendgrid' | 'smtp';
        from: string;
        sendgridApiKey?: string;
        smtp?: {
            host: string;
            port: number;
            secure: boolean;
            user?: string;
            pass?: string;
        };
    };
}
export declare function loadConfig(): Config;
//# sourceMappingURL=config.d.ts.map