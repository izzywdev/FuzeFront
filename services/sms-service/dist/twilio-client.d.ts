import type { TwilioConfig } from './config';
export interface TwilioVerifyClient {
    verify: {
        v2: {
            services(sid: string): {
                verifications: {
                    create(opts: {
                        to: string;
                        channel: 'sms';
                    }): Promise<{
                        status: string;
                    }>;
                };
                verificationChecks: {
                    create(opts: {
                        to: string;
                        code: string;
                    }): Promise<{
                        status: string;
                    }>;
                };
            };
        };
    };
}
/**
 * Mock Twilio client for CI / inert mode.
 * send always returns status "pending"; check returns "approved" only for code "000000".
 */
export declare function createMockTwilioClient(): TwilioVerifyClient;
export declare function createTwilioClient(cfg: TwilioConfig): TwilioVerifyClient;
//# sourceMappingURL=twilio-client.d.ts.map