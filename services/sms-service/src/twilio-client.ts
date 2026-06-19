import twilio from 'twilio';
import type { TwilioConfig } from './config';

export interface TwilioVerifyClient {
  verify: {
    v2: {
      services(sid: string): {
        verifications: {
          create(opts: { to: string; channel: 'sms' }): Promise<{ status: string }>;
        };
        verificationChecks: {
          create(opts: { to: string; code: string }): Promise<{ status: string }>;
        };
      };
    };
  };
}

/**
 * Mock Twilio client for CI / inert mode.
 * send always returns status "pending"; check returns "approved" only for code "000000".
 */
export function createMockTwilioClient(): TwilioVerifyClient {
  return {
    verify: {
      v2: {
        services(_sid: string) {
          return {
            verifications: {
              async create(_opts: { to: string; channel: 'sms' }) {
                return { status: 'pending' };
              },
            },
            verificationChecks: {
              async create(opts: { to: string; code: string }) {
                return { status: opts.code === '000000' ? 'approved' : 'pending' };
              },
            },
          };
        },
      },
    },
  };
}

export function createTwilioClient(cfg: TwilioConfig): TwilioVerifyClient {
  if (cfg.mock) {
    return createMockTwilioClient();
  }
  return twilio(cfg.accountSid, cfg.authToken) as unknown as TwilioVerifyClient;
}
