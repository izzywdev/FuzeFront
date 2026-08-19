# SMS Verify MFA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `services/sms-service` — a thin synchronous HTTP gateway that wraps the Twilio Verify API for SMS OTP, and wire it as the Authentik generic-SMS MFA stage.

**Architecture:** sms-service is a pure HTTP service (no Kafka) with two endpoints: `POST /sms/send` and `POST /sms/verify`. Authentik's generic-SMS MFA stage calls these directly. Twilio Verify handles OTP generation, delivery, and checking; sms-service adds shared-secret auth, E.164 validation, and defense-in-depth rate limiting. A mock Twilio client enables fully offline CI.

**Tech Stack:** TypeScript 5, Express 4, twilio SDK (^5), zod 3, jest 29 / ts-jest, Node 18-alpine Docker, Helm 3, Authentik Blueprint v3.

## Global Constraints

- Mirror `services/email-service` structure exactly: same tsconfig, jest.config, Dockerfile 3-stage pattern, package.json scripts, port naming.
- No Kafka. sms-service has no `@fuzefront/shared` dependency.
- Twilio Verify API only — no raw Messaging / A2P-10DLC.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` come from chart Secret (empty defaults → inert/mock mode).
- `SMS_AUTH_SECRET` shared-secret header used by Authentik to authenticate requests.
- Service port: 3004 (email-service owns 3003).
- `smsService.enabled: false` default in values.yaml (gated).
- All user input (`to`, `code`) must be validated before passing to Twilio — never interpolate raw user strings.
- `verificationChecks.create` returns `status: 'pending'` for wrong code, never throws — map pending → failure without throwing.
- Tests must pass with mock Twilio client; CI needs no real account.
- `npm run build` must be clean (no TypeScript errors) before any commit.

---

## File Map

### New files
- `services/sms-service/package.json`
- `services/sms-service/tsconfig.json`
- `services/sms-service/jest.config.js`
- `services/sms-service/Dockerfile`
- `services/sms-service/src/config.ts` — env → Config interface
- `services/sms-service/src/twilio-client.ts` — factory: real Twilio or mock
- `services/sms-service/src/rate-limiter.ts` — in-memory per-(phone,IP) cooldown + max/hour
- `services/sms-service/src/routes/send.ts` — POST /sms/send handler
- `services/sms-service/src/routes/verify.ts` — POST /sms/verify handler
- `services/sms-service/src/app.ts` — Express factory (auth middleware + routes + /health)
- `services/sms-service/src/index.ts` — entry point (start server)
- `services/sms-service/tests/tsconfig.json`
- `services/sms-service/tests/send.test.ts`
- `services/sms-service/tests/verify.test.ts`
- `services/sms-service/tests/rate-limiter.test.ts`
- `services/sms-service/tests/auth.test.ts`
- `services/sms-service/tests/health.test.ts`
- `deploy/helm/fuzefront/templates/sms-service.yaml`
- `deploy/helm/fuzefront/authentik/blueprints/stages-sms.yaml`

### Modified files
- `lerna.json` — add `services/sms-service` to packages
- `skaffold.yaml` — add artifact + setValueTemplate for smsService
- `docker-compose.yml` — add sms-service service
- `.github/workflows/release.yml` — add paths trigger + build/push step
- `deploy/helm/fuzefront/values.yaml` — add `smsService` block + `secret.twilioAccountSid` etc
- `deploy/helm/fuzefront/values-prod.yaml` — add `smsService.image` stanza
- `deploy/helm/fuzefront/templates/secret.yaml` — add conditional Twilio secret keys

---

### Task 1: Service scaffold (package.json, tsconfig, jest.config, Dockerfile)

**Files:**
- Create: `services/sms-service/package.json`
- Create: `services/sms-service/tsconfig.json`
- Create: `services/sms-service/jest.config.js`
- Create: `services/sms-service/tests/tsconfig.json`
- Create: `services/sms-service/Dockerfile`

**Interfaces:**
- Produces: npm scripts `build`, `start`, `test`; Docker image `fuzefront/sms-service` on port 3004.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@fuzefront/sms-service",
  "version": "1.0.0",
  "description": "Twilio Verify SMS OTP gateway for FuzeFront MFA",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "nodemon --exec ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "express": "4.19.2",
    "twilio": "^5.3.0",
    "zod": "3.22.4"
  },
  "devDependencies": {
    "@types/express": "4.17.21",
    "@types/node": "18.19.0",
    "@types/supertest": "6.0.2",
    "jest": "29.7.0",
    "nodemon": "3.0.1",
    "supertest": "6.3.3",
    "ts-jest": "29.1.1",
    "ts-node": "10.9.2",
    "typescript": "5.1.6"
  }
}
```

File path: `services/sms-service/package.json`

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": false,
    "noImplicitAny": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

File path: `services/sms-service/tsconfig.json`

- [ ] **Step 3: Create jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  testTimeout: 10000,
};
```

File path: `services/sms-service/jest.config.js`

- [ ] **Step 4: Create tests/tsconfig.json**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "rootDir": "..",
    "noEmit": true
  },
  "include": ["../src/**/*", "./**/*"]
}
```

File path: `services/sms-service/tests/tsconfig.json`

- [ ] **Step 5: Create Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
COPY package.json package-lock.json ./
COPY services/sms-service/package.json ./services/sms-service/

# Install only production deps for sms-service
RUN npm ci --workspace=services/sms-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/sms-service/package.json ./services/sms-service/

RUN npm ci --workspace=services/sms-service --ignore-scripts

# Copy source
COPY services/sms-service/ ./services/sms-service/

# Build sms-service
RUN cd services/sms-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S smsservice && adduser -S smsservice -G smsservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/sms-service/node_modules ./services/sms-service/node_modules
COPY --from=build /app/services/sms-service/dist ./services/sms-service/dist

# Remove declaration files from production image
RUN find ./services/sms-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/sms-service

ENV PORT=3004
ENV NODE_ENV=production

EXPOSE 3004

USER smsservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

File path: `services/sms-service/Dockerfile`

- [ ] **Step 6: Install dependencies**

```bash
cd D:\source\FuzeFront\.claude\worktrees\agent-a21ef995601d3ea91
npm install --workspace=services/sms-service
```

Expected: package-lock.json updated, node_modules for sms-service populated.

- [ ] **Step 7: Commit**

```bash
git add services/sms-service/package.json services/sms-service/tsconfig.json services/sms-service/jest.config.js services/sms-service/tests/tsconfig.json services/sms-service/Dockerfile package-lock.json
git commit -m "feat(sms): scaffold sms-service package (TS, Dockerfile, jest)"
```

---

### Task 2: Config, Twilio client factory, rate limiter

**Files:**
- Create: `services/sms-service/src/config.ts`
- Create: `services/sms-service/src/twilio-client.ts`
- Create: `services/sms-service/src/rate-limiter.ts`
- Test: `services/sms-service/tests/rate-limiter.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(): Config` — reads env vars
  - `Config` interface with `port`, `authSecret`, `twilio: { accountSid, authToken, verifyServiceSid, mock }`, `rateLimiter: { cooldownMs, maxPerHour }`
  - `createTwilioClient(config: Config['twilio']): TwilioVerifyClient` — returns real or mock client
  - `TwilioVerifyClient` interface: `{ verifications: { create(opts: { to: string; channel: 'sms' }): Promise<{ status: string }> }, verificationChecks: { create(opts: { to: string; code: string }): Promise<{ status: string }> } }`
  - `RateLimiter` class: `check(phone: string, ip: string): void` (throws `RateLimitError` when exceeded), `RateLimitError` class

- [ ] **Step 1: Write the failing rate-limiter test**

Create `services/sms-service/tests/rate-limiter.test.ts`:

```typescript
import { RateLimiter, RateLimitError } from '../src/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first request', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    expect(() => rl.check('+15551234567', '127.0.0.1')).not.toThrow();
  });

  it('blocks a second request within the cooldown window', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    expect(() => rl.check('+15551234567', '127.0.0.1')).toThrow(RateLimitError);
  });

  it('allows a request after the cooldown passes', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551234567', '127.0.0.1');
    jest.advanceTimersByTime(31_000);
    expect(() => rl.check('+15551234567', '127.0.0.1')).not.toThrow();
  });

  it('blocks after maxPerHour is exceeded (different IPs, same phone)', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 3 });
    rl.check('+15551234567', '1.1.1.1');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '2.2.2.2');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '3.3.3.3');
    jest.advanceTimersByTime(1);
    expect(() => rl.check('+15551234567', '4.4.4.4')).toThrow(RateLimitError);
  });

  it('blocks after maxPerHour is exceeded (same phone, same IP)', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    rl.check('+15559999999', '10.0.0.1');
    jest.advanceTimersByTime(1);
    expect(() => rl.check('+15559999999', '10.0.0.1')).toThrow(RateLimitError);
  });

  it('resets hourly count after one hour passes', () => {
    const rl = new RateLimiter({ cooldownMs: 0, maxPerHour: 2 });
    rl.check('+15551234567', '1.1.1.1');
    jest.advanceTimersByTime(1);
    rl.check('+15551234567', '2.2.2.2');
    jest.advanceTimersByTime(3_601_000);
    expect(() => rl.check('+15551234567', '3.3.3.3')).not.toThrow();
  });

  it('different phones do not share state', () => {
    const rl = new RateLimiter({ cooldownMs: 30_000, maxPerHour: 5 });
    rl.check('+15551111111', '127.0.0.1');
    expect(() => rl.check('+15552222222', '127.0.0.1')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/sms-service && npx jest tests/rate-limiter.test.ts --no-coverage 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../src/rate-limiter'`

- [ ] **Step 3: Create src/rate-limiter.ts**

```typescript
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

interface RateLimiterOptions {
  cooldownMs: number;  // minimum ms between sends per phone
  maxPerHour: number;  // max sends per phone per hour (across all IPs)
}

interface PhoneState {
  lastSentAt: number;           // epoch ms of the last send
  hourlySends: number[];        // timestamps of sends in the rolling hour window
}

export class RateLimiter {
  private readonly cooldownMs: number;
  private readonly maxPerHour: number;
  private readonly state = new Map<string, PhoneState>();

  constructor(opts: RateLimiterOptions) {
    this.cooldownMs = opts.cooldownMs;
    this.maxPerHour = opts.maxPerHour;
  }

  /**
   * Check if a send is allowed for the given phone + IP.
   * Records the attempt if allowed; throws RateLimitError if not.
   * The IP is included in the key so per-(phone,IP) cooldown applies.
   * maxPerHour is phone-wide (across all IPs).
   */
  check(phone: string, ip: string): void {
    const now = Date.now();
    const key = `${phone}::${ip}`;

    // Per-(phone,IP) cooldown: use a separate entry keyed by phone+ip
    const perIpKey = `__perip__${key}`;
    const perIpState = this.state.get(perIpKey) ?? { lastSentAt: 0, hourlySends: [] };
    if (this.cooldownMs > 0 && now - perIpState.lastSentAt < this.cooldownMs) {
      throw new RateLimitError(
        `Rate limited: wait ${Math.ceil((this.cooldownMs - (now - perIpState.lastSentAt)) / 1000)}s before retrying`
      );
    }

    // Per-phone hourly cap: use a phone-only entry
    const phoneState = this.state.get(phone) ?? { lastSentAt: 0, hourlySends: [] };
    const hourAgo = now - 3_600_000;
    const recentSends = phoneState.hourlySends.filter((t) => t > hourAgo);
    if (recentSends.length >= this.maxPerHour) {
      throw new RateLimitError(
        `Rate limited: max ${this.maxPerHour} SMS per hour exceeded for this number`
      );
    }

    // Record the send
    perIpState.lastSentAt = now;
    this.state.set(perIpKey, perIpState);

    recentSends.push(now);
    phoneState.hourlySends = recentSends;
    phoneState.lastSentAt = now;
    this.state.set(phone, phoneState);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd services/sms-service && npx jest tests/rate-limiter.test.ts --no-coverage
```

Expected: PASS — 7 tests passing.

- [ ] **Step 5: Create src/config.ts**

```typescript
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
  mock: boolean;  // true when accountSid starts with 'AC_TEST' or TWILIO_MOCK=true
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
```

- [ ] **Step 6: Create src/twilio-client.ts**

```typescript
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
```

- [ ] **Step 7: Commit**

```bash
git add services/sms-service/src/config.ts services/sms-service/src/twilio-client.ts services/sms-service/src/rate-limiter.ts services/sms-service/tests/rate-limiter.test.ts
git commit -m "feat(sms): config, twilio client factory, rate limiter (tested)"
```

---

### Task 3: Express app — auth middleware, /sms/send, /sms/verify, /health

**Files:**
- Create: `services/sms-service/src/routes/send.ts`
- Create: `services/sms-service/src/routes/verify.ts`
- Create: `services/sms-service/src/app.ts`
- Test: `services/sms-service/tests/send.test.ts`
- Test: `services/sms-service/tests/verify.test.ts`
- Test: `services/sms-service/tests/auth.test.ts`
- Test: `services/sms-service/tests/health.test.ts`

**Interfaces:**
- Consumes: `TwilioVerifyClient` (from `../twilio-client`), `RateLimiter` (from `../rate-limiter`), `Config` (from `../config`)
- Produces: `createApp(deps: AppDeps): Express` — injectable deps for testing

- [ ] **Step 1: Write the failing tests for /health**

Create `services/sms-service/tests/health.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

const mockClient = createMockTwilioClient();
const rateLimiter = new RateLimiter({ cooldownMs: 0, maxPerHour: 100 });
const app = createApp({
  authSecret: 'test-secret',
  twilioClient: mockClient,
  verifyServiceSid: 'VA_TEST',
  rateLimiter,
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('sms-service');
  });
});
```

- [ ] **Step 2: Write the failing tests for shared-secret auth**

Create `services/sms-service/tests/auth.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

const mockClient = createMockTwilioClient();
const rateLimiter = new RateLimiter({ cooldownMs: 0, maxPerHour: 100 });
const app = createApp({
  authSecret: 'super-secret',
  twilioClient: mockClient,
  verifyServiceSid: 'VA_TEST',
  rateLimiter,
});

describe('Auth middleware', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await request(app)
      .post('/sms/send')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer wrong-secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct secret', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer super-secret')
      .send({ to: '+15551234567' });
    // Will be 200 (mock client) not 401
    expect(res.status).not.toBe(401);
  });

  it('allows /health without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Write the failing tests for /sms/send**

Create `services/sms-service/tests/send.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient, TwilioVerifyClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

function makeApp(client: TwilioVerifyClient) {
  return createApp({
    authSecret: 'secret',
    twilioClient: client,
    verifyServiceSid: 'VA_TEST',
    rateLimiter: new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
  });
}

describe('POST /sms/send', () => {
  it('returns 200 for a valid E.164 phone', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('calls verifications.create with the correct phone and channel', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ status: 'pending' });
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: mockCreate },
            verificationChecks: { create: jest.fn() },
          }),
        },
      },
    };
    const app = makeApp(client);
    await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(mockCreate).toHaveBeenCalledWith({ to: '+15551234567', channel: 'sms' });
  });

  it('returns 400 for a non-E.164 phone number', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '5551234567' }); // missing +
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limiter blocks', async () => {
    const app = createApp({
      authSecret: 'secret',
      twilioClient: createMockTwilioClient(),
      verifyServiceSid: 'VA_TEST',
      rateLimiter: new RateLimiter({ cooldownMs: 3_600_000, maxPerHour: 1 }),
    });
    // First request passes
    await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15557654321' });
    // Second request within cooldown is blocked
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15557654321' });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 4: Write the failing tests for /sms/verify**

Create `services/sms-service/tests/verify.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient, TwilioVerifyClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

function makeApp(client: TwilioVerifyClient) {
  return createApp({
    authSecret: 'secret',
    twilioClient: client,
    verifyServiceSid: 'VA_TEST',
    rateLimiter: new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
  });
}

describe('POST /sms/verify', () => {
  it('returns 200 with verified:true when code is approved', async () => {
    // Mock client returns approved for code "000000"
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '000000' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('returns 200 with verified:false when code is pending (wrong code)', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '999999' });
    // Must NOT throw — pending maps to verified:false
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('calls verificationChecks.create with the correct phone and code', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ status: 'approved' });
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: jest.fn() },
            verificationChecks: { create: mockCreate },
          }),
        },
      },
    };
    const app = makeApp(client);
    await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '123456' });
    expect(mockCreate).toHaveBeenCalledWith({ to: '+15551234567', code: '123456' });
  });

  it('returns 400 for non-E.164 phone', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: 'not-a-phone', code: '123456' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing code', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric code', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: 'abcdef' });
    expect(res.status).toBe(400);
  });

  it('does not throw when Twilio returns an unexpected status', async () => {
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: jest.fn() },
            verificationChecks: {
              create: jest.fn().mockResolvedValue({ status: 'canceled' }),
            },
          }),
        },
      },
    };
    const app = makeApp(client);
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });
});
```

- [ ] **Step 5: Run all tests to verify they fail**

```bash
cd services/sms-service && npx jest --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 6: Create src/routes/send.ts**

```typescript
import { Request, Response } from 'express';
import { z } from 'zod';
import type { TwilioVerifyClient } from '../twilio-client';
import type { RateLimiter } from '../rate-limiter';
import { RateLimitError } from '../rate-limiter';

const E164_RE = /^\+[1-9]\d{6,14}$/;

const sendSchema = z.object({
  to: z.string().regex(E164_RE, 'Phone number must be in E.164 format (e.g. +15551234567)'),
});

interface SendDeps {
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
  rateLimiter: RateLimiter;
}

export function makeSendHandler(deps: SendDeps) {
  return async function sendHandler(req: Request, res: Response): Promise<void> {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });
      return;
    }
    const { to } = parsed.data;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress
      ?? 'unknown';

    try {
      deps.rateLimiter.check(to, ip);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      throw err;
    }

    await deps.twilioClient.verify.v2
      .services(deps.verifyServiceSid)
      .verifications.create({ to, channel: 'sms' });

    res.json({ ok: true });
  };
}
```

- [ ] **Step 7: Create src/routes/verify.ts**

```typescript
import { Request, Response } from 'express';
import { z } from 'zod';
import type { TwilioVerifyClient } from '../twilio-client';

const E164_RE = /^\+[1-9]\d{6,14}$/;
const CODE_RE = /^\d{4,8}$/;

const verifySchema = z.object({
  to: z.string().regex(E164_RE, 'Phone number must be in E.164 format'),
  code: z.string().regex(CODE_RE, 'Code must be 4–8 digits'),
});

interface VerifyDeps {
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
}

export function makeVerifyHandler(deps: VerifyDeps) {
  return async function verifyHandler(req: Request, res: Response): Promise<void> {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });
      return;
    }
    const { to, code } = parsed.data;

    // verificationChecks.create returns status: 'approved' | 'pending' | 'canceled' | 'expired'
    // It does NOT throw on wrong code — pending means wrong code.
    const check = await deps.twilioClient.verify.v2
      .services(deps.verifyServiceSid)
      .verificationChecks.create({ to, code });

    res.json({ verified: check.status === 'approved' });
  };
}
```

- [ ] **Step 8: Create src/app.ts**

```typescript
import express, { Application, Request, Response, NextFunction } from 'express';
import type { TwilioVerifyClient } from './twilio-client';
import type { RateLimiter } from './rate-limiter';
import { makeSendHandler } from './routes/send';
import { makeVerifyHandler } from './routes/verify';

export interface AppDeps {
  authSecret: string;
  twilioClient: TwilioVerifyClient;
  verifyServiceSid: string;
  rateLimiter: RateLimiter;
}

export function createApp(deps: AppDeps): Application {
  const app = express();
  app.use(express.json());

  // Health — no auth required
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'sms-service' });
  });

  // Shared-secret auth middleware for all /sms/* routes
  app.use('/sms', (req: Request, res: Response, next: NextFunction) => {
    if (!deps.authSecret) {
      // No secret configured — reject all (prevents accidental open access)
      res.status(401).json({ error: 'SMS service not configured (no auth secret)' });
      return;
    }
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token || token !== deps.authSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.post('/sms/send', makeSendHandler({
    twilioClient: deps.twilioClient,
    verifyServiceSid: deps.verifyServiceSid,
    rateLimiter: deps.rateLimiter,
  }));

  app.post('/sms/verify', makeVerifyHandler({
    twilioClient: deps.twilioClient,
    verifyServiceSid: deps.verifyServiceSid,
  }));

  return app;
}
```

- [ ] **Step 9: Run all tests to verify they pass**

```bash
cd services/sms-service && npx jest --no-coverage
```

Expected: PASS — all tests in send.test.ts, verify.test.ts, auth.test.ts, health.test.ts, rate-limiter.test.ts.

- [ ] **Step 10: Verify TypeScript build is clean**

```bash
cd services/sms-service && npm run build
```

Expected: no errors, `dist/` created.

- [ ] **Step 11: Commit**

```bash
git add services/sms-service/src/ services/sms-service/tests/
git commit -m "feat(sms): /sms/send, /sms/verify, /health with auth + rate limiter (tested)"
```

---

### Task 4: Entry point and wiring into lerna/skaffold/docker-compose/release

**Files:**
- Create: `services/sms-service/src/index.ts`
- Modify: `lerna.json`
- Modify: `skaffold.yaml`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `createApp(AppDeps)`, `loadConfig()`, `createTwilioClient()`, `RateLimiter`
- Produces: HTTP server on `config.port`, graceful SIGTERM/SIGINT shutdown.

- [ ] **Step 1: Create src/index.ts**

```typescript
import { loadConfig } from './config';
import { createTwilioClient } from './twilio-client';
import { RateLimiter } from './rate-limiter';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  const twilioClient = createTwilioClient(config.twilio);
  const rateLimiter = new RateLimiter(config.rateLimiter);

  const app = createApp({
    authSecret: config.authSecret,
    twilioClient,
    verifyServiceSid: config.twilio.verifyServiceSid,
    rateLimiter,
  });

  const server = app.listen(config.port, () => {
    const mode = config.twilio.mock ? 'mock' : 'live';
    console.log(`[sms-service] Listening on port ${config.port} (Twilio: ${mode})`);
  });

  const shutdown = () => {
    console.log('[sms-service] Shutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[sms-service] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add sms-service to lerna.json**

In `lerna.json`, change the packages array from:
```json
"packages": ["backend", "frontend", "shared", "sdk", "task-manager-app", "services/email-service"]
```
to:
```json
"packages": ["backend", "frontend", "shared", "sdk", "task-manager-app", "services/email-service", "services/sms-service"]
```

- [ ] **Step 3: Add sms-service artifact to skaffold.yaml**

After the `email-service` artifact block (ends at line `dockerfile: services/email-service/Dockerfile`), add:

```yaml
    - image: fuzefront/sms-service
      context: .
      docker:
        dockerfile: services/sms-service/Dockerfile
```

And after `emailService.image.tag: "{{.IMAGE_TAG_fuzefront_email_service}}"`, add:

```yaml
          smsService.image.repository: "{{.IMAGE_REPO_fuzefront_sms_service}}"
          smsService.image.tag: "{{.IMAGE_TAG_fuzefront_sms_service}}"
```

- [ ] **Step 4: Add sms-service to docker-compose.yml**

After the `email-service` service block, add:

```yaml
  # ================================
  # SMS SERVICE (Twilio Verify MFA)
  # ================================
  sms-service:
    build:
      context: .
      dockerfile: services/sms-service/Dockerfile
    ports:
      - "3004:3004"
    environment:
      - NODE_ENV=development
      - TWILIO_MOCK=true
      - SMS_AUTH_SECRET=${SMS_AUTH_SECRET:-dev-sms-secret}
    networks:
      - FuzeInfra
    depends_on:
      - fuzefront-backend
```

- [ ] **Step 5: Add sms-service to release.yml**

In `.github/workflows/release.yml`, add `services/sms-service/**` to the paths trigger, then add after the email-service build step:

```yaml
      - name: Build and push sms-service
        uses: docker/build-push-action@v5
        with:
          context: .
          file: services/sms-service/Dockerfile
          push: true
          tags: |
            ghcr.io/izzywdev/fuzefront-sms-service:${{ steps.tag.outputs.sha }}
            ghcr.io/izzywdev/fuzefront-sms-service:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 6: Verify build still passes**

```bash
cd services/sms-service && npm run build && npx jest --no-coverage
```

Expected: build clean, tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/sms-service/src/index.ts lerna.json skaffold.yaml docker-compose.yml .github/workflows/release.yml
git commit -m "feat(sms): wire sms-service into lerna, skaffold, docker-compose, release CI"
```

---

### Task 5: Helm chart wiring (values, secret, Deployment+Service template, values-prod)

**Files:**
- Modify: `deploy/helm/fuzefront/values.yaml`
- Modify: `deploy/helm/fuzefront/templates/secret.yaml`
- Create: `deploy/helm/fuzefront/templates/sms-service.yaml`
- Modify: `deploy/helm/fuzefront/values-prod.yaml`

**Interfaces:**
- Produces: `smsService.enabled` gate, `secret.twilioAccountSid/twilioAuthToken/twilioVerifyServiceSid/smsAuthSecret` keys.

- [ ] **Step 1: Add smsService block to values.yaml**

After the `emailService:` block (which ends at `resources: {}`), add:

```yaml
smsService:
  enabled: false
  replicas: 1
  port: 3004
  image:
    repository: fuzefront/sms-service
    tag: local
  resources: {}
```

Also in the `secret:` block, after `sendgridApiKey: ""`, add:

```yaml
  # Twilio Verify credentials for SMS MFA. Leave empty to run in mock/inert mode.
  # Supply real values via --set or a gitignored values file. NEVER commit real creds.
  twilioAccountSid: ""
  twilioAuthToken: ""
  twilioVerifyServiceSid: ""
  smsAuthSecret: "dev-sms-secret-change-me"
```

- [ ] **Step 2: Add Twilio keys to templates/secret.yaml**

After the `{{- if .Values.secret.sendgridApiKey }}` block (before the Google block), add:

```yaml
  {{- if .Values.secret.twilioAccountSid }}
  TWILIO_ACCOUNT_SID: {{ .Values.secret.twilioAccountSid | quote }}
  {{- end }}
  {{- if .Values.secret.twilioAuthToken }}
  TWILIO_AUTH_TOKEN: {{ .Values.secret.twilioAuthToken | quote }}
  {{- end }}
  {{- if .Values.secret.twilioVerifyServiceSid }}
  TWILIO_VERIFY_SERVICE_SID: {{ .Values.secret.twilioVerifyServiceSid | quote }}
  {{- end }}
  {{- if .Values.secret.smsAuthSecret }}
  SMS_AUTH_SECRET: {{ .Values.secret.smsAuthSecret | quote }}
  {{- end }}
```

- [ ] **Step 3: Create templates/sms-service.yaml**

```yaml
{{- if .Values.smsService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzefront-sms-service
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
    app.kubernetes.io/component: sms-service
spec:
  replicas: {{ .Values.smsService.replicas }}
  selector:
    matchLabels:
      app: fuzefront-sms-service
  template:
    metadata:
      labels:
        app: fuzefront-sms-service
        {{- include "fuzefront.labels" . | nindent 8 }}
    spec:
      containers:
        - name: sms-service
          image: "{{ .Values.smsService.image.repository }}:{{ .Values.smsService.image.tag }}"
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          ports:
            - containerPort: {{ .Values.smsService.port }}
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: {{ .Values.smsService.port | quote }}
            {{- if .Values.secret.twilioAccountSid }}
            - name: TWILIO_ACCOUNT_SID
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: TWILIO_ACCOUNT_SID
            - name: TWILIO_AUTH_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: TWILIO_AUTH_TOKEN
            - name: TWILIO_VERIFY_SERVICE_SID
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: TWILIO_VERIFY_SERVICE_SID
            {{- end }}
            - name: SMS_AUTH_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: SMS_AUTH_SECRET
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .Values.smsService.port }}
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .Values.smsService.port }}
            initialDelaySeconds: 30
            periodSeconds: 15
          resources:
            {{- toYaml .Values.smsService.resources | nindent 12 }}
---
apiVersion: v1
kind: Service
metadata:
  name: fuzefront-sms-service
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
spec:
  selector:
    app: fuzefront-sms-service
  ports:
    - port: {{ .Values.smsService.port }}
      targetPort: {{ .Values.smsService.port }}
{{- end }}
```

- [ ] **Step 4: Add smsService image stanza to values-prod.yaml**

After the `emailService:` block in values-prod.yaml, add:

```yaml
smsService:
  image:
    repository: ghcr.io/izzywdev/fuzefront-sms-service
    tag: local
```

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/fuzefront/values.yaml deploy/helm/fuzefront/templates/secret.yaml deploy/helm/fuzefront/templates/sms-service.yaml deploy/helm/fuzefront/values-prod.yaml
git commit -m "feat(sms): helm chart — smsService deployment/service + Twilio secret keys"
```

---

### Task 6: Authentik blueprint — wire SMS MFA stage

**Files:**
- Create: `deploy/helm/fuzefront/authentik/blueprints/stages-sms.yaml`
- Modify: `deploy/helm/fuzefront/authentik/blueprints/stages-mfa.yaml` (replace stub with reference comment)

**Interfaces:**
- Produces: Authentik `fuzefront-mfa-sms-setup` stage (generic-SMS, provider=generic, send_url + verify_url + shared_secret via `!Env`) and `fuzefront-mfa-sms-validate` validation stage; SMS added as optional device_class to `fuzefront-mfa-validate`.

Note on Authentik generic-SMS vs Twilio native: Authentik's `authenticatorsmsstage` has a `provider` field that can be set to `generic` to call arbitrary HTTP URLs. That is how sms-service integrates — as a generic HTTP provider, not Twilio-native. The Twilio logic lives inside sms-service; Authentik just calls the HTTP endpoints.

- [ ] **Step 1: Create stages-sms.yaml**

```yaml
# Authentik Blueprint — FuzeFront SMS MFA stages
#
# Wires the generic-SMS MFA stage to the sms-service HTTP gateway.
# The sms-service calls Twilio Verify internally; Authentik sees only
# the two HTTP endpoints below.
#
# Prerequisites:
#   - smsService.enabled=true in Helm values
#   - secret.twilioAccountSid / twilioAuthToken / twilioVerifyServiceSid set
#   - secret.smsAuthSecret set (used by Authentik to authenticate to sms-service)
#   - AUTHENTIK_SMS_SEND_URL / AUTHENTIK_SMS_VERIFY_URL / AUTHENTIK_SMS_AUTH_SECRET
#     env vars set on the Authentik worker pod (via Helm deployment env injection)
#
# The SMS stage is kept optional (not_configured_action: skip) so users without
# a phone number enrolled are not blocked from logging in.
version: 3
metadata:
  name: FuzeFront SMS MFA Stages
entries:
  # ── Generic-SMS setup stage ──────────────────────────────────────────────────
  # Authentik's generic-SMS provider calls send_url to deliver the OTP,
  # then verify_url to check it. The shared_secret is sent as the
  # Authorization: Bearer <secret> header (Authentik 2024.x+ supports this
  # via the mapping_expression field or direct header injection in the stage).
  #
  # Mapping_expression sends the Authorization header:
  #   return {"Authorization": "Bearer " + request.user.attributes.get("sms_auth_secret", env.get("AUTHENTIK_SMS_AUTH_SECRET", ""))}
  #
  # Note: authentik_stages_authenticator_sms provider=generic uses:
  #   send_url: POST {send_url} body={"to": "<phone>"}
  #   verify_url: POST {verify_url} body={"to": "<phone>", "code": "<otp>"}
  - model: authentik_stages_authenticator_sms.authenticatorsmsstage
    state: present
    identifiers:
      name: fuzefront-mfa-sms-setup
    attrs:
      name: fuzefront-mfa-sms-setup
      friendly_name: "FuzeFront SMS"
      provider: generic
      # sms-service URLs — injected from worker env
      from_number: !Env [AUTHENTIK_SMS_FROM, "FuzeFront"]
      account_sid: !Env [AUTHENTIK_SMS_SEND_URL, "http://fuzefront-sms-service:3004/sms/send"]
      auth_token: !Env [AUTHENTIK_SMS_AUTH_SECRET, ""]
      # verify_only=true means this stage only verifies; a separate check stage handles the OTP input
      verify_only: false
      # mapping_expression for the Authorization header (Authentik 2024.x)
      mapping_expression: |
        import os
        return {
          "Authorization": "Bearer " + os.environ.get("AUTHENTIK_SMS_AUTH_SECRET", "")
        }

  # ── Authenticator-validation stage (updated to include SMS) ──────────────────
  # This replaces the stages-mfa.yaml validate stage to add 'sms' as a device class.
  # It uses state: present so it is idempotent — re-applying will update device_classes.
  - model: authentik_stages_authenticator_validate.authenticatorvalidatestage
    state: present
    identifiers:
      name: fuzefront-mfa-validate
    attrs:
      name: fuzefront-mfa-validate
      device_classes:
        - totp
        - webauthn
        - sms
      # Not required for unenrolled users — SMS is optional.
      not_configured_action: skip
```

- [ ] **Step 2: Update stages-mfa.yaml SMS stub comment**

In `deploy/helm/fuzefront/authentik/blueprints/stages-mfa.yaml`, replace the SMS stub entry comment from:

```yaml
  # ── SMS stub stage (UNBOUND — deferred to later plan) ─────────────────────────
  # Defined here for schema completeness. Not bound to any flow until Twilio
  # credentials are available. To activate: bind this stage to an auth flow
  # and set twilio_account_sid / twilio_auth_token / twilio_from_number via
  # Helm values (backed by a SealedSecret).
  - model: authentik_stages_authenticator_sms.authenticatorsmsstage
    state: present
    identifiers:
      name: fuzefront-mfa-sms-stub
    attrs:
      name: fuzefront-mfa-sms-stub
      friendly_name: "FuzeFront SMS (stub — not active)"
      provider: twilio
      # Placeholder credentials — replace with real Twilio creds in prod.
      account_sid: ""
      auth_token: ""
      from_number: ""
      verify_only: false
```

with:

```yaml
  # ── SMS stage (activated by stages-sms.yaml) ──────────────────────────────────
  # The real SMS MFA stage is defined in stages-sms.yaml (generic HTTP provider
  # calling sms-service, which calls Twilio Verify). The stub entry has been
  # superseded. stages-sms.yaml is applied by the same Helm ConfigMap and
  # Authentik worker auto-discovery.
```

- [ ] **Step 3: Commit**

```bash
git add deploy/helm/fuzefront/authentik/blueprints/stages-sms.yaml deploy/helm/fuzefront/authentik/blueprints/stages-mfa.yaml
git commit -m "feat(sms): authentik blueprint wires generic-SMS stage to sms-service"
```

---

### Task 7: Final verification pass — build + all tests clean

- [ ] **Step 1: Install dependencies from workspace root**

```bash
cd D:\source\FuzeFront\.claude\worktrees\agent-a21ef995601d3ea91
npm install
```

Expected: no errors.

- [ ] **Step 2: Run sms-service build**

```bash
cd services/sms-service && npm run build
```

Expected: `dist/` created with no TypeScript errors.

- [ ] **Step 3: Run all sms-service tests**

```bash
cd services/sms-service && npm test -- --no-coverage
```

Expected: all tests PASS. Suite includes:
- `tests/health.test.ts` — /health returns 200
- `tests/auth.test.ts` — missing/wrong secret → 401, correct → passes, /health exempt
- `tests/send.test.ts` — E.164 valid → 200, invalid → 400, rate limited → 429, calls verifications.create
- `tests/verify.test.ts` — approved → verified:true, pending → verified:false (no throw), unexpected status → verified:false, invalid phone/code → 400
- `tests/rate-limiter.test.ts` — cooldown, maxPerHour, per-phone isolation, reset after 1h

- [ ] **Step 4: Commit (only if any fixup was needed)**

```bash
git add -p
git commit -m "fix(sms): address any issues from final verification pass"
```

---

## Self-Review Checklist

- [x] `/sms/send` calls `verifications.create({ to, channel: 'sms' })` — Task 3, send.ts
- [x] `/sms/verify` maps `approved` → `verified:true`, `pending` → `verified:false`, never throws — Task 3, verify.ts
- [x] E.164 validation with regex on both endpoints — Task 3, send.ts + verify.ts
- [x] Shared-secret auth middleware rejects unauthenticated — Task 3, app.ts + auth.test.ts
- [x] Rate limiter per-(phone, IP) cooldown + max/hour — Task 2, rate-limiter.ts
- [x] Mock Twilio client for CI — Task 2, twilio-client.ts
- [x] `/health` — Task 3, app.ts
- [x] Twilio config env vars — Task 2, config.ts
- [x] Dockerfile mirrors email-service 3-stage pattern — Task 1
- [x] lerna.json updated — Task 4
- [x] skaffold.yaml artifact + setValueTemplate — Task 4
- [x] docker-compose sms-service service — Task 4
- [x] release.yml paths trigger + build step — Task 4
- [x] Helm values smsService block + secret keys — Task 5
- [x] Helm templates/sms-service.yaml conditional deployment+service — Task 5
- [x] Helm templates/secret.yaml Twilio keys — Task 5
- [x] values-prod.yaml image stanza — Task 5
- [x] Authentik blueprint stages-sms.yaml — Task 6
- [x] No Kafka consumers or Kafka events — per spec (Verify is synchronous HTTP)
- [x] `smsService.enabled: false` default — Task 5
- [x] `npm run build` must be clean — verified in Task 7
