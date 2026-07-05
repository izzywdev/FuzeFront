import { User } from '../types/shared';
declare class OIDCService {
    private client;
    private config;
    constructor();
    initialize(): Promise<void>;
    generateAuthUrl(state?: string): {
        url: string;
        codeVerifier: string;
    };
    handleCallback(code: string, state: string | undefined, codeVerifier: string): Promise<User>;
    private syncUserToDatabase;
    isConfigured(): boolean;
}
export declare const oidcService: OIDCService;
export {};
//# sourceMappingURL=oidc.d.ts.map