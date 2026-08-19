import { User } from '../types/shared';
declare global {
    var codeVerifiers: Map<string, string> | undefined;
}
declare class OIDCService {
    private client;
    private config;
    constructor();
    initialize(): Promise<void>;
    generateAuthUrl(state?: string): string;
    handleCallback(code: string, state?: string): Promise<User>;
    private syncUserToDatabase;
    isConfigured(): boolean;
}
export declare const oidcService: OIDCService;
export {};
//# sourceMappingURL=oidc.d.ts.map