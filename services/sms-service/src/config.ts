export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
  mock: boolean; // true when accountSid is empty or TWILIO_MOCK=true
}

export interface Config {
  port: number;
  authSecret: string;
  twilio: TwilioConfig;
  rateLimiter: {
    cooldownMs: number;
    maxPerHour: number;
  };
}

export function loadConfig(): Config {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';
  // Mock mode: no real creds, or explicitly requested via env
  const mock =
    process.env.TWILIO_MOCK === 'true' ||
    accountSid === '' ||
    accountSid.startsWith('AC_TEST');

  return {
    port: parseInt(process.env.PORT ?? '3004', 10),
    authSecret: process.env.SMS_AUTH_SECRET ?? '',
    twilio: { accountSid, authToken, verifyServiceSid, mock },
    rateLimiter: {
      cooldownMs: parseInt(process.env.RATE_COOLDOWN_MS ?? '30000', 10),
      maxPerHour: parseInt(process.env.RATE_MAX_PER_HOUR ?? '10', 10),
    },
  };
}
