# Kafka Foundation + Email Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kafka messaging substrate in `shared/` (versioned event schemas + a KafkaJS client wrapper) and a new `services/email-service` that consumes `notify.email.requested`, renders/sends emails via SendGrid (with SMTP fallback), and emits `notify.email.status`.

**Architecture:** The `@fuzefront/shared` package gains a `kafka/` sub-tree: typed event schemas (versioned with a `version` field discriminated union), a thin `KafkaClient` factory wrapping KafkaJS (injectable for tests), and producer/consumer helpers. `services/email-service` is a standalone Node/TypeScript Express service that uses only the `shared` kafka layer; its Kafka client, email provider, and template renderer are all injected so every handler can be unit-tested without a live broker or SMTP server. Infrastructure wiring (Dockerfile, Helm chart, skaffold artifact, CI release job entry) mirrors the existing `backend` pattern exactly.

**Tech Stack:** TypeScript 5, KafkaJS 2.2.4, `@sendgrid/mail` 8.1.3, `nodemailer` 6.9.14 (SMTP fallback), `express` 4.19.2, `ts-jest` 29, `jest` 29, `zod` 3.22.4 (schema validation), `node:18-alpine` Docker base.

## Global Constraints

- TypeScript strict mode **off** for `services/email-service` (match `backend` — `"strict": false, "noImplicitAny": false`)
- `shared/` uses its existing `"strict": true` tsconfig; the new Kafka sub-tree must compile cleanly under it
- Node >= 18, npm >= 9
- Pin every new dependency to an exact minor version (e.g. `"kafkajs": "2.2.4"`)
- All unit tests must run without a live Kafka broker, SendGrid account, or SMTP server
- Secret: SendGrid API key via `SENDGRID_API_KEY` env var, sourced from the chart Secret; never hardcoded
- Kafka broker addresses: docker-compose `fuzeinfra-kafka:9092` / host `localhost:29092`; k8s `kafka.fuzeinfra.svc.cluster.local:9092`
- Image name pattern: `ghcr.io/izzywdev/fuzefront-email-service`
- No Co-Authored-By lines in commits
- Do NOT touch `frontend/`, `backend/src/`, or any file not explicitly listed in a task's "Files" block unless the task says to

---

## File Map

### New files — `shared/src/kafka/`
| File | Responsibility |
|------|---------------|
| `shared/src/kafka/types.ts` | Base `FuzeEvent<T>` envelope + topic name constants |
| `shared/src/kafka/schemas/identity.user.created.ts` | Zod schema + TypeScript type for `identity.user.created` v1 |
| `shared/src/kafka/schemas/notify.email.requested.ts` | Zod schema + TS type for `notify.email.requested` v1 |
| `shared/src/kafka/schemas/notify.email.status.ts` | Zod schema + TS type for `notify.email.status` v1 |
| `shared/src/kafka/schemas/index.ts` | Re-exports all schemas |
| `shared/src/kafka/client.ts` | `KafkaClient` factory (injectable Kafka instance); `createProducer()`, `createConsumer()` |
| `shared/src/kafka/producer.ts` | `TypedProducer` — wraps KafkaJS producer; validates event with Zod before sending |
| `shared/src/kafka/consumer.ts` | `TypedConsumer` — wraps KafkaJS consumer; validates incoming message, routes to handler, dead-letters on parse failure |
| `shared/src/kafka/index.ts` | Barrel export for kafka sub-tree |

### New files — `services/email-service/`
| File | Responsibility |
|------|---------------|
| `services/email-service/package.json` | npm package `@fuzefront/email-service`; deps + scripts |
| `services/email-service/tsconfig.json` | TS config matching backend conventions |
| `services/email-service/jest.config.js` | ts-jest config mirroring backend |
| `services/email-service/Dockerfile` | Multi-stage build mirroring `backend/Dockerfile` |
| `services/email-service/src/config.ts` | `Config` interface + `loadConfig()` from env |
| `services/email-service/src/templates/index.ts` | `renderTemplate(name, vars)` → `{subject, html, text}` |
| `services/email-service/src/templates/welcome.ts` | Welcome email template (HTML + text) |
| `services/email-service/src/templates/org-invite.ts` | Org invite email template |
| `services/email-service/src/templates/membership-change.ts` | Membership change email template |
| `services/email-service/src/providers/types.ts` | `EmailProvider` interface: `send(msg): Promise<void>` |
| `services/email-service/src/providers/sendgrid.ts` | SendGrid implementation |
| `services/email-service/src/providers/smtp.ts` | Nodemailer SMTP implementation (dev fallback) |
| `services/email-service/src/providers/index.ts` | `createProvider(config)` factory |
| `services/email-service/src/handlers/email-requested.handler.ts` | Pure function: consumes `NotifyEmailRequestedV1`, renders template, calls provider, emits status |
| `services/email-service/src/app.ts` | Express app + `/health` endpoint |
| `services/email-service/src/index.ts` | Entry point: wires Kafka consumer + Express server |
| `services/email-service/tests/handlers/email-requested.handler.test.ts` | Unit tests for the handler (mocked provider + producer) |
| `services/email-service/tests/templates.test.ts` | Unit tests for template rendering |
| `services/email-service/tests/schemas.test.ts` | Unit tests for Zod schema validation |
| `services/email-service/tests/app.test.ts` | Health endpoint test |

### Modified files
| File | Change |
|------|--------|
| `shared/src/index.ts` | Add `export * from './kafka'` |
| `shared/package.json` | Add `kafkajs`, `zod` deps |
| `lerna.json` | Add `services/email-service` to packages array |
| `root package.json` | No change needed (workspaces already covers `shared`; email-service is not a workspace dep) |
| `docker-compose.yml` | Add `email-service` service block |
| `skaffold.yaml` | Add email-service artifact + setValueTemplate |
| `deploy/helm/fuzefront/values.yaml` | Add `emailService.*` block + `secret.sendgridApiKey` |
| `deploy/helm/fuzefront/templates/email-service.yaml` | New: Helm Deployment + Service for email-service |
| `.github/workflows/release.yml` | Add email-service to image build matrix + values sed |

---

## Task 1: Install Kafka + Zod deps in `shared/`; add kafka barrel to `shared/src/index.ts`

**Files:**
- Modify: `shared/package.json`
- Modify: `shared/src/index.ts`
- Create: `shared/src/kafka/index.ts` (empty barrel, filled in later tasks)

**Interfaces:**
- Produces: `@fuzefront/shared` now lists `kafkajs@2.2.4` and `zod@3.22.4`

- [ ] **Step 1: Add deps to `shared/package.json`**

Open `shared/package.json`. Add to `"dependencies"`:
```json
"kafkajs": "2.2.4",
"zod": "3.22.4"
```
Add to `"devDependencies"`:
```json
"@types/node": "^18.19.0"
```

Full updated `shared/package.json`:
```json
{
  "name": "@fuzefront/shared",
  "version": "1.0.0",
  "description": "Shared state library for FuzeFront platform",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "kafkajs": "2.2.4",
    "react": "^18.2.0",
    "zod": "3.22.4"
  },
  "devDependencies": {
    "@types/node": "^18.19.0",
    "@types/react": "^18.2.15",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  }
}
```

- [ ] **Step 2: Create empty kafka barrel**

Create `shared/src/kafka/index.ts`:
```typescript
// Kafka client + schemas — filled in by later tasks
export * from './types';
export * from './schemas';
export * from './client';
export * from './producer';
export * from './consumer';
```

- [ ] **Step 3: Add kafka export to shared index**

Edit `shared/src/index.ts` — append one line at the bottom:
```typescript
export * from './kafka';
```

- [ ] **Step 4: Install deps**

```bash
cd shared && npm install
```
Expected: `added N packages` (no errors). `kafkajs` and `zod` appear in `shared/node_modules/`.

- [ ] **Step 5: Commit**

```bash
git add shared/package.json shared/package-lock.json shared/src/index.ts shared/src/kafka/index.ts
git commit -m "chore(shared): add kafkajs + zod deps; stub kafka barrel"
```

---

## Task 2: Define versioned event types and topic constants in `shared/src/kafka/types.ts`

**Files:**
- Create: `shared/src/kafka/types.ts`

**Interfaces:**
- Produces:
  - `TOPICS` constant object with keys `IDENTITY_USER_CREATED`, `NOTIFY_EMAIL_REQUESTED`, `NOTIFY_EMAIL_STATUS`
  - `FuzeEvent<T>` generic interface with fields `topic`, `version`, `correlationId`, `occurredAt`, `payload: T`
  - `dlqTopic(topic: string): string` helper

- [ ] **Step 1: Create `shared/src/kafka/types.ts`**

```typescript
export const TOPICS = {
  IDENTITY_USER_CREATED: 'identity.user.created',
  NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
  NOTIFY_EMAIL_STATUS: 'notify.email.status',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

/** Envelope wrapping every event published on FuzeFront Kafka topics */
export interface FuzeEvent<T = unknown> {
  /** Semver-style schema version, e.g. "1.0" */
  version: string;
  topic: TopicName;
  /** Caller-supplied idempotency / tracing token */
  correlationId: string;
  occurredAt: string; // ISO-8601
  payload: T;
}

/** Returns the dead-letter queue topic name for a given topic */
export function dlqTopic(topic: string): string {
  return `${topic}.dlq`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd shared && npm run type-check
```
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/kafka/types.ts
git commit -m "feat(shared/kafka): add topic constants, FuzeEvent envelope, dlqTopic helper"
```

---

## Task 3: Define Zod schemas for all three events

**Files:**
- Create: `shared/src/kafka/schemas/identity.user.created.ts`
- Create: `shared/src/kafka/schemas/notify.email.requested.ts`
- Create: `shared/src/kafka/schemas/notify.email.status.ts`
- Create: `shared/src/kafka/schemas/index.ts`

**Interfaces:**
- Produces:
  - `IdentityUserCreatedPayloadV1` (Zod-inferred type)
  - `identityUserCreatedSchemaV1` (Zod object schema)
  - `NotifyEmailRequestedPayloadV1` (Zod-inferred type)
  - `notifyEmailRequestedSchemaV1` (Zod object schema)
  - `NotifyEmailStatusPayloadV1` (Zod-inferred type)
  - `notifyEmailStatusSchemaV1` (Zod object schema)

- [ ] **Step 1: Create `shared/src/kafka/schemas/identity.user.created.ts`**

```typescript
import { z } from 'zod';

export const identityUserCreatedSchemaV1 = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  /** Why the user was created: initial sign-up or org invitation */
  intent: z.enum(['signup', 'org-invite']),
});

export type IdentityUserCreatedPayloadV1 = z.infer<typeof identityUserCreatedSchemaV1>;
```

- [ ] **Step 2: Create `shared/src/kafka/schemas/notify.email.requested.ts`**

```typescript
import { z } from 'zod';

export const SUPPORTED_TEMPLATES = ['welcome', 'org-invite', 'membership-change'] as const;

export const notifyEmailRequestedSchemaV1 = z.object({
  to: z.string().email(),
  template: z.enum(SUPPORTED_TEMPLATES),
  vars: z.record(z.string(), z.unknown()),
  orgId: z.string().optional(),
  correlationId: z.string(),
});

export type NotifyEmailRequestedPayloadV1 = z.infer<typeof notifyEmailRequestedSchemaV1>;
```

- [ ] **Step 3: Create `shared/src/kafka/schemas/notify.email.status.ts`**

```typescript
import { z } from 'zod';

export const notifyEmailStatusSchemaV1 = z.object({
  correlationId: z.string(),
  to: z.string().email(),
  template: z.string(),
  status: z.enum(['sent', 'failed', 'dead-lettered']),
  error: z.string().optional(),
  providerMessageId: z.string().optional(),
  attemptedAt: z.string(), // ISO-8601
});

export type NotifyEmailStatusPayloadV1 = z.infer<typeof notifyEmailStatusSchemaV1>;
```

- [ ] **Step 4: Create `shared/src/kafka/schemas/index.ts`**

```typescript
export * from './identity.user.created';
export * from './notify.email.requested';
export * from './notify.email.status';
```

- [ ] **Step 5: Type-check**

```bash
cd shared && npm run type-check
```
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add shared/src/kafka/schemas/
git commit -m "feat(shared/kafka): versioned Zod schemas for 3 events (identity.user.created, notify.email.requested, notify.email.status)"
```

---

## Task 4: KafkaJS client factory + typed producer/consumer in `shared/src/kafka/`

**Files:**
- Create: `shared/src/kafka/client.ts`
- Create: `shared/src/kafka/producer.ts`
- Create: `shared/src/kafka/consumer.ts`

**Interfaces:**
- Produces:
  - `createKafkaClient(config: KafkaClientConfig): Kafka` (KafkaJS instance)
  - `TypedProducer` class with `connect(): Promise<void>`, `send<T>(topic, event: FuzeEvent<T>, schema: ZodSchema<T>): Promise<void>`, `disconnect(): Promise<void>`
  - `TypedConsumer` class with `connect(): Promise<void>`, `subscribe(topic): Promise<void>`, `run(handler: (event: FuzeEvent<unknown>) => Promise<void>, schema: ZodSchema, dlqProducer?: TypedProducer): Promise<void>`, `disconnect(): Promise<void>`
- Consumes: `FuzeEvent<T>` from `./types`; `ZodSchema` from `zod`

- [ ] **Step 1: Create `shared/src/kafka/client.ts`**

```typescript
import { Kafka, KafkaConfig } from 'kafkajs';

export interface KafkaClientConfig {
  clientId: string;
  brokers: string[];
  /** Retry config; defaults to KafkaJS defaults */
  retry?: KafkaConfig['retry'];
}

/**
 * Factory so callers can inject a mock Kafka instance in tests.
 * Production code calls this once at startup.
 */
export function createKafkaClient(config: KafkaClientConfig): Kafka {
  return new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    retry: config.retry,
  });
}
```

- [ ] **Step 2: Create `shared/src/kafka/producer.ts`**

```typescript
import { Producer, Kafka } from 'kafkajs';
import { ZodSchema } from 'zod';
import { FuzeEvent, TopicName, dlqTopic } from './types';

export class TypedProducer {
  private producer: Producer;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  /**
   * Validates `event.payload` against `schema` then sends the event.
   * Throws ZodError if validation fails (caller should dead-letter).
   */
  async send<T>(
    topic: TopicName | string,
    event: FuzeEvent<T>,
    schema: ZodSchema<T>
  ): Promise<void> {
    schema.parse(event.payload); // throws ZodError on failure
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }],
    });
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  /** Expose the raw KafkaJS producer for testing */
  get raw(): Producer {
    return this.producer;
  }
}
```

- [ ] **Step 3: Create `shared/src/kafka/consumer.ts`**

```typescript
import { Consumer, Kafka } from 'kafkajs';
import { ZodSchema, ZodError } from 'zod';
import { FuzeEvent, dlqTopic } from './types';
import { TypedProducer } from './producer';

export type EventHandler<T> = (event: FuzeEvent<T>) => Promise<void>;

export class TypedConsumer {
  private consumer: Consumer;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
  }

  async connect(): Promise<void> {
    await this.consumer.connect();
  }

  async subscribe(topic: string, fromBeginning = false): Promise<void> {
    await this.consumer.subscribe({ topic, fromBeginning });
  }

  /**
   * Runs the consumer loop.
   * - Deserializes each message as JSON.
   * - Validates the payload with `schema`.
   * - On ZodError or JSON parse failure, emits to the DLQ topic via `dlqProducer`
   *   (if provided) and skips the message so the consumer stays healthy.
   */
  async run<T>(
    handler: EventHandler<T>,
    schema: ZodSchema<T>,
    dlqProducer?: TypedProducer
  ): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        let envelope: FuzeEvent<unknown>;
        try {
          envelope = JSON.parse(raw) as FuzeEvent<unknown>;
        } catch (err) {
          await this.deadLetter(topic, raw, 'JSON parse failure', dlqProducer);
          return;
        }

        let parsed: T;
        try {
          parsed = schema.parse(envelope.payload);
        } catch (err) {
          const msg = err instanceof ZodError ? err.message : String(err);
          await this.deadLetter(topic, raw, msg, dlqProducer);
          return;
        }

        await handler({ ...envelope, payload: parsed });
      },
    });
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async deadLetter(
    sourceTopic: string,
    raw: string,
    reason: string,
    dlqProducer?: TypedProducer
  ): Promise<void> {
    console.error(`[TypedConsumer] Dead-lettering message from ${sourceTopic}: ${reason}`);
    if (dlqProducer) {
      const dlq = dlqTopic(sourceTopic);
      await dlqProducer.raw.send({
        topic: dlq,
        messages: [{ value: JSON.stringify({ raw, reason, sourceTopic }) }],
      });
    }
  }
}
```

- [ ] **Step 4: Type-check shared**

```bash
cd shared && npm run type-check
```
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/kafka/client.ts shared/src/kafka/producer.ts shared/src/kafka/consumer.ts
git commit -m "feat(shared/kafka): KafkaClient factory, TypedProducer, TypedConsumer with DLQ support"
```

---

## Task 5: Bootstrap `services/email-service` package scaffold

**Files:**
- Create: `services/email-service/package.json`
- Create: `services/email-service/tsconfig.json`
- Create: `services/email-service/jest.config.js`
- Create: `services/email-service/tests/tsconfig.json`
- Modify: `lerna.json`

**Interfaces:**
- Produces: runnable `npm test` + `npm run build` in `services/email-service/`

- [ ] **Step 1: Create `services/email-service/package.json`**

```json
{
  "name": "@fuzefront/email-service",
  "version": "1.0.0",
  "description": "Kafka consumer that sends transactional emails for FuzeFront",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "nodemon --exec ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "@fuzefront/shared": "1.0.0",
    "@sendgrid/mail": "8.1.3",
    "express": "4.19.2",
    "kafkajs": "2.2.4",
    "nodemailer": "6.9.14",
    "zod": "3.22.4"
  },
  "devDependencies": {
    "@types/express": "4.17.21",
    "@types/node": "18.19.0",
    "@types/nodemailer": "6.4.14",
    "jest": "29.7.0",
    "nodemon": "3.0.1",
    "ts-jest": "29.1.1",
    "ts-node": "10.9.2",
    "typescript": "5.1.6"
  }
}
```

- [ ] **Step 2: Create `services/email-service/tsconfig.json`**

Match `backend/tsconfig.json` conventions (ES2020, commonjs, no strict):
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

- [ ] **Step 3: Create `services/email-service/tests/tsconfig.json`**

Mirror `backend/tests/tsconfig.json` pattern:
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

- [ ] **Step 4: Create `services/email-service/jest.config.js`**

```js
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

- [ ] **Step 5: Add to `lerna.json`**

Open `lerna.json`. The current `packages` array is:
```json
["backend", "frontend", "shared", "sdk", "task-manager-app"]
```
Change it to:
```json
["backend", "frontend", "shared", "sdk", "task-manager-app", "services/email-service"]
```

- [ ] **Step 6: Install deps**

```bash
cd services/email-service && npm install
```
Expected: exits 0.

- [ ] **Step 7: Run tests (should be empty — no test files yet)**

```bash
cd services/email-service && npm test -- --passWithNoTests
```
Expected: `Test Suites: 0 skipped`, exits 0.

- [ ] **Step 8: Commit**

```bash
git add services/email-service/package.json services/email-service/package-lock.json services/email-service/tsconfig.json services/email-service/jest.config.js services/email-service/tests/tsconfig.json lerna.json
git commit -m "chore(email-service): scaffold package with tsconfig, jest, lerna registration"
```

---

## Task 6: Config loader and email provider abstraction

**Files:**
- Create: `services/email-service/src/config.ts`
- Create: `services/email-service/src/providers/types.ts`
- Create: `services/email-service/src/providers/sendgrid.ts`
- Create: `services/email-service/src/providers/smtp.ts`
- Create: `services/email-service/src/providers/index.ts`

**Interfaces:**
- Produces:
  - `Config` interface + `loadConfig(): Config`
  - `EmailProvider` interface: `send(msg: EmailMessage): Promise<{messageId?: string}>`
  - `EmailMessage` interface: `{to, subject, html, text, from?}`
  - `createProvider(config: Config): EmailProvider`

- [ ] **Step 1: Write failing test for config loader**

Create `services/email-service/tests/config.test.ts`:
```typescript
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('reads required env vars', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.EMAIL_FROM = 'noreply@example.com';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';

    const cfg = loadConfig();

    expect(cfg.kafka.brokers).toEqual(['localhost:9092']);
    expect(cfg.email.from).toBe('noreply@example.com');
    expect(cfg.email.provider).toBe('smtp');
  });

  it('splits KAFKA_BROKERS on comma', () => {
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
    const cfg = loadConfig();
    expect(cfg.kafka.brokers).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd services/email-service && npm test -- tests/config.test.ts
```
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 3: Create `services/email-service/src/config.ts`**

```typescript
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

export function loadConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'fuzeinfra-kafka:9092')
    .split(',')
    .map((b) => b.trim());

  const provider = (process.env.EMAIL_PROVIDER || 'smtp') as 'sendgrid' | 'smtp';

  return {
    port: parseInt(process.env.PORT || '3003', 10),
    kafka: {
      brokers,
      clientId: process.env.KAFKA_CLIENT_ID || 'email-service',
      groupId: process.env.KAFKA_GROUP_ID || 'email-service-group',
    },
    email: {
      provider,
      from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
      sendgridApiKey: process.env.SENDGRID_API_KEY,
      smtp:
        provider === 'smtp'
          ? {
              host: process.env.SMTP_HOST || 'localhost',
              port: parseInt(process.env.SMTP_PORT || '1025', 10),
              secure: process.env.SMTP_SECURE === 'true',
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
    },
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/email-service && npm test -- tests/config.test.ts
```
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Create `services/email-service/src/providers/types.ts`**

```typescript
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
```

- [ ] **Step 6: Create `services/email-service/src/providers/sendgrid.ts`**

```typescript
import sgMail from '@sendgrid/mail';
import { EmailMessage, EmailProvider, SendResult } from './types';
import { Config } from '../config';

export class SendGridProvider implements EmailProvider {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey);
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const [response] = await sgMail.send({
      to: msg.to,
      from: msg.from || 'noreply@fuzefront.com',
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { messageId: response.headers['x-message-id'] as string | undefined };
  }
}
```

- [ ] **Step 7: Create `services/email-service/src/providers/smtp.ts`**

```typescript
import nodemailer from 'nodemailer';
import { EmailMessage, EmailProvider, SendResult } from './types';
import { Config } from '../config';

export class SmtpProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(smtpConfig: NonNullable<Config['email']['smtp']>) {
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth:
        smtpConfig.user && smtpConfig.pass
          ? { user: smtpConfig.user, pass: smtpConfig.pass }
          : undefined,
    });
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { messageId: info.messageId };
  }
}
```

- [ ] **Step 8: Create `services/email-service/src/providers/index.ts`**

```typescript
import { Config } from '../config';
import { EmailProvider } from './types';
import { SendGridProvider } from './sendgrid';
import { SmtpProvider } from './smtp';

export { EmailProvider, EmailMessage, SendResult } from './types';

export function createProvider(config: Config): EmailProvider {
  if (config.email.provider === 'sendgrid') {
    if (!config.email.sendgridApiKey) {
      throw new Error('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid');
    }
    return new SendGridProvider(config.email.sendgridApiKey);
  }
  if (!config.email.smtp) {
    throw new Error('SMTP config is required when EMAIL_PROVIDER=smtp');
  }
  return new SmtpProvider(config.email.smtp);
}
```

- [ ] **Step 9: Run all tests so far**

```bash
cd services/email-service && npm test
```
Expected: `config.test.ts` passes; no other test files yet.

- [ ] **Step 10: Commit**

```bash
git add services/email-service/src/config.ts services/email-service/src/providers/ services/email-service/tests/config.test.ts
git commit -m "feat(email-service): config loader + EmailProvider abstraction (SendGrid + SMTP)"
```

---

## Task 7: Email template renderer

**Files:**
- Create: `services/email-service/src/templates/welcome.ts`
- Create: `services/email-service/src/templates/org-invite.ts`
- Create: `services/email-service/src/templates/membership-change.ts`
- Create: `services/email-service/src/templates/index.ts`
- Create: `services/email-service/tests/templates.test.ts`

**Interfaces:**
- Produces:
  - `TemplateResult` interface: `{subject: string; html: string; text: string}`
  - `renderTemplate(name: SupportedTemplate, vars: Record<string, unknown>): TemplateResult`

- [ ] **Step 1: Write failing template test**

Create `services/email-service/tests/templates.test.ts`:
```typescript
import { renderTemplate } from '../src/templates';

describe('renderTemplate', () => {
  it('renders welcome email with firstName', () => {
    const result = renderTemplate('welcome', { firstName: 'Alice', loginUrl: 'https://app.fuzefront.com' });
    expect(result.subject).toContain('Welcome');
    expect(result.html).toContain('Alice');
    expect(result.text).toContain('Alice');
  });

  it('renders org-invite with orgName and inviteUrl', () => {
    const result = renderTemplate('org-invite', {
      orgName: 'Acme Corp',
      inviteUrl: 'https://app.fuzefront.com/accept?token=abc',
      inviterName: 'Bob',
    });
    expect(result.subject).toContain('Acme Corp');
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('Bob');
  });

  it('renders membership-change with action', () => {
    const result = renderTemplate('membership-change', {
      orgName: 'Acme Corp',
      action: 'added',
      role: 'member',
    });
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('added');
  });

  it('throws on unknown template', () => {
    expect(() => renderTemplate('unknown' as any, {})).toThrow(/Unknown template/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd services/email-service && npm test -- tests/templates.test.ts
```
Expected: FAIL — `Cannot find module '../src/templates'`

- [ ] **Step 3: Create `services/email-service/src/templates/welcome.ts`**

```typescript
import { TemplateResult } from './index';

export function renderWelcome(vars: Record<string, unknown>): TemplateResult {
  const firstName = String(vars.firstName || 'there');
  const loginUrl = String(vars.loginUrl || 'https://app.fuzefront.com');
  return {
    subject: `Welcome to FuzeFront, ${firstName}!`,
    html: `<h1>Welcome, ${firstName}!</h1><p>Your FuzeFront account is ready.</p><p><a href="${loginUrl}">Log in now</a></p>`,
    text: `Welcome, ${firstName}!\n\nYour FuzeFront account is ready.\n\nLog in: ${loginUrl}`,
  };
}
```

- [ ] **Step 4: Create `services/email-service/src/templates/org-invite.ts`**

```typescript
import { TemplateResult } from './index';

export function renderOrgInvite(vars: Record<string, unknown>): TemplateResult {
  const orgName = String(vars.orgName || 'your organization');
  const inviteUrl = String(vars.inviteUrl || '#');
  const inviterName = String(vars.inviterName || 'A colleague');
  return {
    subject: `You've been invited to ${orgName} on FuzeFront`,
    html: `<h1>You're invited!</h1><p>${inviterName} has invited you to join <strong>${orgName}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
    text: `You're invited!\n\n${inviterName} has invited you to join ${orgName}.\n\nAccept: ${inviteUrl}`,
  };
}
```

- [ ] **Step 5: Create `services/email-service/src/templates/membership-change.ts`**

```typescript
import { TemplateResult } from './index';

export function renderMembershipChange(vars: Record<string, unknown>): TemplateResult {
  const orgName = String(vars.orgName || 'your organization');
  const action = String(vars.action || 'updated');
  const role = String(vars.role || 'member');
  return {
    subject: `Your membership in ${orgName} has been ${action}`,
    html: `<p>Your membership in <strong>${orgName}</strong> has been <strong>${action}</strong>. Your role is <strong>${role}</strong>.</p>`,
    text: `Your membership in ${orgName} has been ${action}. Your role is ${role}.`,
  };
}
```

- [ ] **Step 6: Create `services/email-service/src/templates/index.ts`**

```typescript
import { SUPPORTED_TEMPLATES } from '@fuzefront/shared';
import { renderWelcome } from './welcome';
import { renderOrgInvite } from './org-invite';
import { renderMembershipChange } from './membership-change';

export interface TemplateResult {
  subject: string;
  html: string;
  text: string;
}

type SupportedTemplate = (typeof SUPPORTED_TEMPLATES)[number];

const renderers: Record<SupportedTemplate, (vars: Record<string, unknown>) => TemplateResult> = {
  welcome: renderWelcome,
  'org-invite': renderOrgInvite,
  'membership-change': renderMembershipChange,
};

export function renderTemplate(name: SupportedTemplate, vars: Record<string, unknown>): TemplateResult {
  const renderer = renderers[name];
  if (!renderer) {
    throw new Error(`Unknown template: ${name}`);
  }
  return renderer(vars);
}
```

- [ ] **Step 7: Run tests — expect pass**

```bash
cd services/email-service && npm test -- tests/templates.test.ts
```
Expected: PASS — 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/email-service/src/templates/ services/email-service/tests/templates.test.ts
git commit -m "feat(email-service): welcome, org-invite, membership-change email templates"
```

---

## Task 8: Schema validation unit tests (validate shared schemas from email-service context)

**Files:**
- Create: `services/email-service/tests/schemas.test.ts`

**Interfaces:**
- Consumes: `notifyEmailRequestedSchemaV1`, `notifyEmailStatusSchemaV1`, `identityUserCreatedSchemaV1` from `@fuzefront/shared`

- [ ] **Step 1: Write schema tests**

Create `services/email-service/tests/schemas.test.ts`:
```typescript
import {
  notifyEmailRequestedSchemaV1,
  notifyEmailStatusSchemaV1,
  identityUserCreatedSchemaV1,
  TOPICS,
  dlqTopic,
} from '@fuzefront/shared';

describe('notifyEmailRequestedSchemaV1', () => {
  it('accepts a valid event payload', () => {
    const payload = {
      to: 'alice@example.com',
      template: 'welcome' as const,
      vars: { firstName: 'Alice' },
      orgId: 'org-123',
      correlationId: 'corr-abc',
    };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects missing correlationId', () => {
    const payload = { to: 'alice@example.com', template: 'welcome', vars: {} };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });

  it('rejects invalid email address', () => {
    const payload = { to: 'not-an-email', template: 'welcome', vars: {}, correlationId: 'x' };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });

  it('rejects unknown template name', () => {
    const payload = { to: 'a@b.com', template: 'nonexistent', vars: {}, correlationId: 'x' };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });
});

describe('notifyEmailStatusSchemaV1', () => {
  it('accepts a valid status event', () => {
    const payload = {
      correlationId: 'corr-abc',
      to: 'alice@example.com',
      template: 'welcome',
      status: 'sent' as const,
      attemptedAt: new Date().toISOString(),
    };
    expect(() => notifyEmailStatusSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects invalid status', () => {
    const payload = {
      correlationId: 'x',
      to: 'a@b.com',
      template: 'welcome',
      status: 'bounced',
      attemptedAt: new Date().toISOString(),
    };
    expect(() => notifyEmailStatusSchemaV1.parse(payload)).toThrow();
  });
});

describe('identityUserCreatedSchemaV1', () => {
  it('accepts a valid user-created payload', () => {
    const payload = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'alice@example.com',
      firstName: 'Alice',
      intent: 'signup' as const,
    };
    expect(() => identityUserCreatedSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects non-UUID userId', () => {
    const payload = { userId: 'not-a-uuid', email: 'a@b.com', intent: 'signup' };
    expect(() => identityUserCreatedSchemaV1.parse(payload)).toThrow();
  });
});

describe('TOPICS and dlqTopic', () => {
  it('has the three required topics', () => {
    expect(TOPICS.IDENTITY_USER_CREATED).toBe('identity.user.created');
    expect(TOPICS.NOTIFY_EMAIL_REQUESTED).toBe('notify.email.requested');
    expect(TOPICS.NOTIFY_EMAIL_STATUS).toBe('notify.email.status');
  });

  it('appends .dlq', () => {
    expect(dlqTopic('notify.email.requested')).toBe('notify.email.requested.dlq');
  });
});
```

- [ ] **Step 2: Run — ensure shared is built first**

```bash
cd shared && npm run build && cd ../services/email-service && npm test -- tests/schemas.test.ts
```
Expected: PASS — 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/email-service/tests/schemas.test.ts
git commit -m "test(email-service): schema validation tests for all three event schemas"
```

---

## Task 9: Email-requested handler (core business logic, fully unit-tested)

**Files:**
- Create: `services/email-service/src/handlers/email-requested.handler.ts`
- Create: `services/email-service/tests/handlers/email-requested.handler.test.ts`

**Interfaces:**
- Consumes: `NotifyEmailRequestedPayloadV1`, `notifyEmailStatusSchemaV1`, `FuzeEvent`, `TOPICS` from `@fuzefront/shared`; `renderTemplate` from `../templates`; `EmailProvider` from `../providers`; `TypedProducer` from `@fuzefront/shared`
- Produces: `handleEmailRequested(event: FuzeEvent<NotifyEmailRequestedPayloadV1>, deps: HandlerDeps): Promise<void>`

- [ ] **Step 1: Write failing handler test**

Create `services/email-service/tests/handlers/email-requested.handler.test.ts`:
```typescript
import { handleEmailRequested, HandlerDeps } from '../../src/handlers/email-requested.handler';
import { FuzeEvent, TOPICS, NotifyEmailRequestedPayloadV1 } from '@fuzefront/shared';

function makeEvent(overrides: Partial<NotifyEmailRequestedPayloadV1> = {}): FuzeEvent<NotifyEmailRequestedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.NOTIFY_EMAIL_REQUESTED,
    correlationId: 'corr-test-1',
    occurredAt: new Date().toISOString(),
    payload: {
      to: 'alice@example.com',
      template: 'welcome',
      vars: { firstName: 'Alice' },
      correlationId: 'corr-test-1',
      ...overrides,
    },
  };
}

function makeDeps(): HandlerDeps & { sentMessages: any[]; producedEvents: any[] } {
  const sentMessages: any[] = [];
  const producedEvents: any[] = [];
  return {
    sentMessages,
    producedEvents,
    provider: {
      send: jest.fn(async (msg) => {
        sentMessages.push(msg);
        return { messageId: 'msg-id-1' };
      }),
    },
    statusProducer: {
      send: jest.fn(async (_topic: any, event: any) => {
        producedEvents.push(event);
      }),
    } as any,
    from: 'noreply@fuzefront.com',
  };
}

describe('handleEmailRequested', () => {
  it('renders template and calls provider.send', async () => {
    const deps = makeDeps();
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
    const msg = deps.sentMessages[0];
    expect(msg.to).toBe('alice@example.com');
    expect(msg.html).toContain('Alice');
  });

  it('emits notify.email.status with status=sent on success', async () => {
    const deps = makeDeps();
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.statusProducer.send).toHaveBeenCalledTimes(1);
    const event = deps.producedEvents[0];
    expect(event.payload.status).toBe('sent');
    expect(event.payload.correlationId).toBe('corr-test-1');
  });

  it('emits status=failed when provider throws', async () => {
    const deps = makeDeps();
    (deps.provider.send as jest.Mock).mockRejectedValueOnce(new Error('SMTP timeout'));
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.statusProducer.send).toHaveBeenCalledTimes(1);
    const event = deps.producedEvents[0];
    expect(event.payload.status).toBe('failed');
    expect(event.payload.error).toContain('SMTP timeout');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd services/email-service && npm test -- tests/handlers/email-requested.handler.test.ts
```
Expected: FAIL — `Cannot find module '../../src/handlers/email-requested.handler'`

- [ ] **Step 3: Create `services/email-service/src/handlers/email-requested.handler.ts`**

```typescript
import {
  FuzeEvent,
  NotifyEmailRequestedPayloadV1,
  NotifyEmailStatusPayloadV1,
  notifyEmailStatusSchemaV1,
  TOPICS,
  TypedProducer,
} from '@fuzefront/shared';
import { EmailProvider } from '../providers';
import { renderTemplate } from '../templates';

export interface HandlerDeps {
  provider: EmailProvider;
  statusProducer: Pick<TypedProducer, 'send'>;
  from: string;
}

export async function handleEmailRequested(
  event: FuzeEvent<NotifyEmailRequestedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { payload } = event;
  const { provider, statusProducer, from } = deps;

  let status: NotifyEmailStatusPayloadV1['status'] = 'sent';
  let error: string | undefined;
  let providerMessageId: string | undefined;

  try {
    const rendered = renderTemplate(payload.template, payload.vars);
    const result = await provider.send({
      to: payload.to,
      from,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    providerMessageId = result.messageId;
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    console.error(`[email-handler] Failed to send email to ${payload.to}:`, error);
  }

  const statusPayload: NotifyEmailStatusPayloadV1 = {
    correlationId: payload.correlationId,
    to: payload.to,
    template: payload.template,
    status,
    error,
    providerMessageId,
    attemptedAt: new Date().toISOString(),
  };

  await statusProducer.send(
    TOPICS.NOTIFY_EMAIL_STATUS,
    {
      version: '1.0',
      topic: TOPICS.NOTIFY_EMAIL_STATUS,
      correlationId: event.correlationId,
      occurredAt: new Date().toISOString(),
      payload: statusPayload,
    },
    notifyEmailStatusSchemaV1
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/email-service && npm test -- tests/handlers/email-requested.handler.test.ts
```
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/email-service/src/handlers/ services/email-service/tests/handlers/
git commit -m "feat(email-service): email-requested handler with status emit + error handling"
```

---

## Task 10: Express app + health endpoint

**Files:**
- Create: `services/email-service/src/app.ts`
- Create: `services/email-service/tests/app.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Application` with `GET /health` → `{status: 'ok', service: 'email-service'}`

- [ ] **Step 1: Write failing health test**

Create `services/email-service/tests/app.test.ts`:
```typescript
import request from 'supertest';
import { createApp } from '../src/app';

// supertest is not listed as a dep yet — add it
describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('email-service');
  });
});
```

Add `supertest` to `services/email-service/package.json` devDependencies:
```json
"supertest": "6.3.3",
"@types/supertest": "6.0.2"
```
Then run:
```bash
cd services/email-service && npm install
```

- [ ] **Step 2: Run — expect failure**

```bash
cd services/email-service && npm test -- tests/app.test.ts
```
Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 3: Create `services/email-service/src/app.ts`**

```typescript
import express, { Application, Request, Response } from 'express';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'email-service' });
  });

  return app;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/email-service && npm test -- tests/app.test.ts
```
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add services/email-service/src/app.ts services/email-service/tests/app.test.ts services/email-service/package.json services/email-service/package-lock.json
git commit -m "feat(email-service): Express app with /health endpoint"
```

---

## Task 11: Entry point (wires Kafka consumer + Express server)

**Files:**
- Create: `services/email-service/src/index.ts`

**Interfaces:**
- Consumes: `loadConfig`, `createProvider`, `createApp`, `handleEmailRequested`, `HandlerDeps`, `createKafkaClient`, `TypedProducer`, `TypedConsumer`, `TOPICS`, `notifyEmailRequestedSchemaV1` from their respective modules

- [ ] **Step 1: Create `services/email-service/src/index.ts`**

```typescript
import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
  TOPICS,
  notifyEmailRequestedSchemaV1,
} from '@fuzefront/shared';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { handleEmailRequested } from './handlers/email-requested.handler';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  // --- Email provider ---
  const provider = createProvider(config);

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  const statusProducer = new TypedProducer(kafka);
  await statusProducer.connect();

  const consumer = new TypedConsumer(kafka, config.kafka.groupId);
  await consumer.connect();
  await consumer.subscribe(TOPICS.NOTIFY_EMAIL_REQUESTED);
  await consumer.run(
    (event) => handleEmailRequested(event as any, { provider, statusProducer, from: config.email.from }),
    notifyEmailRequestedSchemaV1,
    statusProducer
  );

  // --- HTTP ---
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[email-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[email-service] Shutting down...');
    await consumer.disconnect();
    await statusProducer.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[email-service] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check (no live broker needed)**

```bash
cd services/email-service && npx tsc --noEmit
```
Expected: exits 0, no type errors.

- [ ] **Step 3: Run full test suite**

```bash
cd services/email-service && npm test
```
Expected: All tests pass (config, templates, schemas, handler, app).

- [ ] **Step 4: Commit**

```bash
git add services/email-service/src/index.ts
git commit -m "feat(email-service): entry point wiring Kafka consumer, SendGrid/SMTP provider, Express server"
```

---

## Task 12: Dockerfile for `email-service`

**Files:**
- Create: `services/email-service/Dockerfile`

**Interfaces:**
- Produces: Docker image that runs `node dist/index.js`, exposes port 3003, runs as non-root

- [ ] **Step 1: Create `services/email-service/Dockerfile`**

Mirror `backend/Dockerfile` exactly, adjusting paths:
```dockerfile
# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/email-service/package.json ./services/email-service/

# Install only production deps for email-service
RUN npm ci --workspace=services/email-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/email-service/package.json ./services/email-service/

RUN npm ci --workspace=services/email-service --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/email-service/ ./services/email-service/

# Build shared first, then email-service
RUN cd shared && npm run build
RUN cd services/email-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S emailservice && adduser -S emailservice -G emailservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/email-service/node_modules ./services/email-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/email-service/dist ./services/email-service/dist

# Remove declaration files from production image
RUN find ./services/email-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/email-service

ENV PORT=3003
ENV NODE_ENV=production

EXPOSE 3003

USER emailservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Commit**

```bash
git add services/email-service/Dockerfile
git commit -m "chore(email-service): Dockerfile mirroring backend multi-stage build"
```

---

## Task 13: Helm chart templates and values for `email-service`

**Files:**
- Create: `deploy/helm/fuzefront/templates/email-service.yaml`
- Modify: `deploy/helm/fuzefront/values.yaml` (add `emailService` block + `secret.sendgridApiKey`)
- Modify: `deploy/helm/fuzefront/templates/secret.yaml` (add `SENDGRID_API_KEY` entry)

**Interfaces:**
- Produces: `fuzefront-email-service` Deployment + Service, gated by `emailService.enabled`

- [ ] **Step 1: Add `emailService` block to `deploy/helm/fuzefront/values.yaml`**

Open `deploy/helm/fuzefront/values.yaml`. Append after the `frontend:` block (before the `ingress:` block):
```yaml
emailService:
  enabled: false
  replicas: 1
  port: 3003
  image:
    repository: fuzefront/email-service
    tag: local
  kafka:
    brokers: "kafka.fuzeinfra.svc.cluster.local:9092"
    clientId: "email-service"
    groupId: "email-service-group"
  email:
    provider: "smtp"  # "sendgrid" or "smtp"
    from: "noreply@fuzefront.com"
  resources: {}
```

Also add to the `secret:` block:
```yaml
  sendgridApiKey: ""
```

- [ ] **Step 2: Modify `deploy/helm/fuzefront/templates/secret.yaml`**

Add the sendgridApiKey entry inside the `stringData:` block (before the closing `{{- end }}`):
```yaml
  {{- if .Values.secret.sendgridApiKey }}
  SENDGRID_API_KEY: {{ .Values.secret.sendgridApiKey | quote }}
  {{- end }}
```

- [ ] **Step 3: Create `deploy/helm/fuzefront/templates/email-service.yaml`**

```yaml
{{- if .Values.emailService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzefront-email-service
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
    app.kubernetes.io/component: email-service
spec:
  replicas: {{ .Values.emailService.replicas }}
  selector:
    matchLabels:
      app: fuzefront-email-service
  template:
    metadata:
      labels:
        app: fuzefront-email-service
        {{- include "fuzefront.labels" . | nindent 8 }}
    spec:
      containers:
        - name: email-service
          image: "{{ .Values.emailService.image.repository }}:{{ .Values.emailService.image.tag }}"
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          ports:
            - containerPort: {{ .Values.emailService.port }}
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: {{ .Values.emailService.port | quote }}
            - name: KAFKA_BROKERS
              value: {{ .Values.emailService.kafka.brokers | quote }}
            - name: KAFKA_CLIENT_ID
              value: {{ .Values.emailService.kafka.clientId | quote }}
            - name: KAFKA_GROUP_ID
              value: {{ .Values.emailService.kafka.groupId | quote }}
            - name: EMAIL_PROVIDER
              value: {{ .Values.emailService.email.provider | quote }}
            - name: EMAIL_FROM
              value: {{ .Values.emailService.email.from | quote }}
            {{- if .Values.secret.sendgridApiKey }}
            - name: SENDGRID_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "fuzefront.secretName" . }}
                  key: SENDGRID_API_KEY
            {{- end }}
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .Values.emailService.port }}
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .Values.emailService.port }}
            initialDelaySeconds: 30
            periodSeconds: 15
          resources:
            {{- toYaml .Values.emailService.resources | nindent 12 }}
---
apiVersion: v1
kind: Service
metadata:
  name: fuzefront-email-service
  labels:
    {{- include "fuzefront.labels" . | nindent 4 }}
spec:
  selector:
    app: fuzefront-email-service
  ports:
    - port: {{ .Values.emailService.port }}
      targetPort: {{ .Values.emailService.port }}
{{- end }}
```

- [ ] **Step 4: Lint helm chart**

```bash
helm lint deploy/helm/fuzefront
```
Expected: `1 chart(s) linted, 0 chart(s) failed`

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/fuzefront/templates/email-service.yaml deploy/helm/fuzefront/values.yaml deploy/helm/fuzefront/templates/secret.yaml
git commit -m "chore(helm): add email-service Deployment+Service template, emailService values block, SENDGRID_API_KEY secret entry"
```

---

## Task 14: Skaffold artifact + release CI job

**Files:**
- Modify: `skaffold.yaml` (add email-service artifact)
- Modify: `.github/workflows/release.yml` (add email-service to image build + values sed)
- Modify: `docker-compose.yml` (add email-service service)

**Interfaces:**
- Produces: `fuzefront/email-service` local Skaffold artifact; `ghcr.io/izzywdev/fuzefront-email-service` in CI

- [ ] **Step 1: Add artifact to `skaffold.yaml`**

Open `skaffold.yaml`. In the `build.artifacts:` array, add after the `clock-app` entry:
```yaml
  - image: fuzefront/email-service
    context: .
    docker:
      dockerfile: services/email-service/Dockerfile
```

In the `deploy.helm.releases[0].setValueTemplates:` block, add:
```yaml
  emailService.image.repository: "{{.IMAGE_REPO_fuzefront_email_service}}"
  emailService.image.tag: "{{.IMAGE_TAG_fuzefront_email_service}}"
```

- [ ] **Step 2: Add email-service to `docker-compose.yml`**

Open `docker-compose.yml`. Add a new service after the `backend` service definition:
```yaml
  email-service:
    build:
      context: .
      dockerfile: services/email-service/Dockerfile
    ports:
      - "3003:3003"
    environment:
      - NODE_ENV=development
      - KAFKA_BROKERS=fuzeinfra-kafka:9092
      - EMAIL_PROVIDER=smtp
      - SMTP_HOST=localhost
      - SMTP_PORT=1025
      - EMAIL_FROM=noreply@fuzefront.local
    networks:
      - FuzeInfra
    depends_on:
      - backend
```

- [ ] **Step 3: Add email-service build step to `.github/workflows/release.yml`**

Open `.github/workflows/release.yml`. The release workflow currently builds `backend` and `frontend`. Find the build+push steps and add an email-service step that mirrors the backend step exactly:

Locate the block that looks like:
```yaml
      - name: Build and push backend
        uses: docker/build-push-action@v5
        with:
          context: backend
          ...
          tags: |
            ghcr.io/izzywdev/fuzefront-backend:${{ env.SHA }}
            ghcr.io/izzywdev/fuzefront-backend:latest
```

Add an analogous block after it:
```yaml
      - name: Build and push email-service
        uses: docker/build-push-action@v5
        with:
          context: .
          file: services/email-service/Dockerfile
          push: true
          tags: |
            ghcr.io/izzywdev/fuzefront-email-service:${{ env.SHA }}
            ghcr.io/izzywdev/fuzefront-email-service:latest
```

Also add `services/email-service/**` to the workflow's `paths:` trigger list so CI fires when the service changes.

Also update the `sed` command that bumps `values-prod.yaml` image tags. The current sed replaces ALL `tag:` lines. That already covers email-service once you add the `emailService.image.tag` line to `values-prod.yaml`. Verify by checking the sed pattern; no change needed if it replaces all `tag:` lines globally.

- [ ] **Step 4: Verify skaffold renders without errors**

```bash
skaffold render --profile local 2>&1 | head -20
```
Expected: no parse errors (may warn about missing images — that's fine locally).

- [ ] **Step 5: Commit**

```bash
git add skaffold.yaml docker-compose.yml .github/workflows/release.yml
git commit -m "chore(ci): add email-service to skaffold artifacts, docker-compose, and release workflow"
```

---

## Task 15: Final wiring check — build shared, run all email-service tests

**Files:** No new files.

- [ ] **Step 1: Build shared so email-service can import it**

```bash
cd shared && npm run build
```
Expected: `dist/` populated, exits 0.

- [ ] **Step 2: Run the full email-service test suite**

```bash
cd services/email-service && npm test
```
Expected output:
```
Test Suites: 5 passed, 5 total
Tests:       XX passed, XX total
```
All test files: `config.test.ts`, `templates.test.ts`, `schemas.test.ts`, `handlers/email-requested.handler.test.ts`, `app.test.ts`.

- [ ] **Step 3: Type-check email-service**

```bash
cd services/email-service && npx tsc --noEmit
```
Expected: exits 0.

- [ ] **Step 4: Helm lint**

```bash
helm lint deploy/helm/fuzefront
```
Expected: `0 chart(s) failed`.

- [ ] **Step 5: Final commit if any last-minute fixes were needed**

```bash
git add -p   # review any outstanding unstaged changes
git commit -m "fix: final type/lint corrections after full integration check"
```
(Skip this commit if there's nothing to fix.)

---

## Self-Review Checklist

**Spec coverage:**
- [x] `shared/` Kafka client wrapper (KafkaJS) — Tasks 1, 4
- [x] Versioned event schemas (`notify.email.requested`, `identity.user.created`, `notify.email.status`) — Tasks 2, 3
- [x] DLQ convention (`<topic>.dlq`) — `dlqTopic()` in Task 2; `TypedConsumer.deadLetter()` in Task 4
- [x] `services/email-service` — Tasks 5–11
- [x] Welcome, org-invite, membership-change templates — Task 7
- [x] SendGrid + SMTP fallback providers — Task 6
- [x] `notify.email.status` emitted on success and failure — Task 9
- [x] Health endpoint — Task 10
- [x] Dead-letter on poison messages — Task 4 (`TypedConsumer`), Task 9 (handler emits `failed` status)
- [x] Dockerfile — Task 12
- [x] Helm Deployment+Service gated by `emailService.enabled` — Task 13
- [x] `secret.sendgridApiKey` via chart Secret — Task 13
- [x] `lerna.json` registration — Task 5
- [x] Skaffold artifact — Task 14
- [x] `release.yml` image build — Task 14
- [x] `docker-compose.yml` service — Task 14
- [x] Unit tests run without live broker — All test tasks use mocks; no KafkaJS instantiation in tests
- [x] Producer helper in `shared/` for backend to use later — `TypedProducer` is exported from `@fuzefront/shared`

**No placeholders found.**

**Type consistency verified:**
- `FuzeEvent<T>` used consistently across Tasks 2, 4, 9
- `NotifyEmailRequestedPayloadV1` defined in Task 3, consumed in Task 9
- `NotifyEmailStatusPayloadV1` defined in Task 3, produced in Task 9
- `TypedProducer.send(topic, event, schema)` signature defined in Task 4, matched in Task 9
- `HandlerDeps.statusProducer` typed as `Pick<TypedProducer, 'send'>` — matches mock in Task 9 test
- `renderTemplate(name, vars)` defined in Task 7, called in Task 9
- `EmailProvider.send(msg)` defined in Task 6, injected into Task 9
