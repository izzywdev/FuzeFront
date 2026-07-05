# Unit 2 Report — billing.llm.usage Kafka topic + schema

## Status: COMPLETE

## Deliverables

### 1. TOPICS const updated
`shared/src/kafka/types.ts` — Added `BILLING_LLM_USAGE: 'billing.llm.usage'` as first entry in the `TOPICS` const (alphabetical placement).

### 2. Schema file created
`shared/src/kafka/schemas/billing.llm.usage.ts` — Created mirroring `notify.email.requested.ts` style:
- Exports `billingLlmUsageSchemaV1` (z.object) with all 8 fields per brief spec:
  - `userId`, `orgId`, `conversationId` — `z.string().uuid()`
  - `model` — `z.string()`
  - `promptTokens`, `completionTokens`, `totalTokens` — `z.number().int().nonnegative()`
  - `timestamp` — `z.string().datetime()`
- Exports `BillingLlmUsagePayloadV1` type inferred from schema
- No `version` field in payload — version lives on the FuzeEvent envelope per brief instructions

### 3. schemas/index.ts updated
Added `export * from './billing.llm.usage';` as first line (alphabetical placement).

## Tests

**Test file chosen:** `services/email-service/tests/schemas.test.ts`

**Rationale:** This is exactly the file the brief specified. It already imports from `@fuzefront/shared` and tests schemas in the same pattern. Added `billingLlmUsageSchemaV1` to the import and added a new `describe('billingLlmUsageSchemaV1')` block with 5 tests:
- accepts a valid payload
- rejects negative token count
- rejects a bad userId (not a UUID)
- rejects a missing required field (`model` omitted)
- rejects an invalid timestamp

Also updated the existing TOPICS test from "three required topics" to "four required topics" to include the new `BILLING_LLM_USAGE` assertion.

## Build + Test Verification

### Kafka build
```
npm run build:kafka -w shared
# → exit 0, no output (clean)
```
Note: `npm run build -w shared` has a pre-existing error (`src/hooks/useSocketBus.ts(2,28): Cannot find module 'socket.io-client'`) that is unrelated to this unit — confirmed by verifying the error exists on the base branch before any changes.

### Type-check (kafka tsconfig, --noEmit)
```
npx tsc -p tsconfig.kafka.json --noEmit  (in shared/)
# → exit 0, no output (clean)
```

### Test run
```
cd services/email-service && npx jest
# Test Suites: 7 passed, 7 total
# Tests:       48 passed, 48 total  (was 43 before this unit; 5 new tests added)
```

## Files Changed
- `shared/src/kafka/types.ts` — added BILLING_LLM_USAGE topic
- `shared/src/kafka/schemas/billing.llm.usage.ts` — created (new file)
- `shared/src/kafka/schemas/index.ts` — added export
- `services/email-service/tests/schemas.test.ts` — added billingLlmUsageSchemaV1 import + describe block, updated TOPICS count assertion

## Concerns
None. Implementation is straightforward and consistent with existing patterns.
