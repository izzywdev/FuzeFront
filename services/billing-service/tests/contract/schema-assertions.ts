/**
 * Lightweight, deterministic schema assertions derived directly from the frozen
 * openapi.yaml component schemas. We keep these hand-written (rather than pulling
 * a JSON-schema validator) so a failure points at the exact field that drifted
 * from the contract, with no extra runtime dependency.
 *
 * Each assertion enforces:
 *   - all REQUIRED fields present
 *   - additionalProperties: false (no undeclared keys leak out)
 *   - the type/shape of each declared field
 */

function assertNoExtraKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  expect(extra).toEqual([]); // contract schemas are additionalProperties:false
  if (extra.length) throw new Error(`${where}: undeclared keys ${extra.join(', ')}`);
}

function assertRequired(obj: Record<string, unknown>, required: string[], where: string): void {
  for (const k of required) {
    expect(obj).toHaveProperty(k);
    if (!(k in obj)) throw new Error(`${where}: missing required key '${k}'`);
  }
}

const isNullableDateTime = (v: unknown): boolean =>
  v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

/** BillingSubscription — components/schemas/BillingSubscription. */
export function assertBillingSubscription(sub: any): void {
  const required = [
    'id',
    'customerId',
    'stripeSubscriptionId',
    'stripePriceId',
    'planTier',
    'status',
    'seatQuantity',
    'trialStart',
    'trialEnd',
    'currentPeriodStart',
    'currentPeriodEnd',
    'cancelAtPeriodEnd',
    'canceledAt',
  ];
  expect(sub && typeof sub).toBe('object');
  assertRequired(sub, required, 'BillingSubscription');
  assertNoExtraKeys(sub, required, 'BillingSubscription');

  expect(typeof sub.id).toBe('string');
  expect(typeof sub.customerId).toBe('string');
  expect(typeof sub.stripeSubscriptionId).toBe('string');
  expect(typeof sub.stripePriceId).toBe('string');
  expect(typeof sub.planTier).toBe('string');
  expect(typeof sub.status).toBe('string');
  expect(Number.isInteger(sub.seatQuantity)).toBe(true);
  expect(sub.seatQuantity).toBeGreaterThanOrEqual(0);
  expect(typeof sub.cancelAtPeriodEnd).toBe('boolean');
  for (const f of ['trialStart', 'trialEnd', 'currentPeriodStart', 'currentPeriodEnd', 'canceledAt']) {
    expect(isNullableDateTime(sub[f])).toBe(true);
  }
}

/** Plan — components/schemas/Plan. */
export function assertPlan(plan: any): void {
  const required = [
    'stripePriceId',
    'stripeProductId',
    'tierName',
    'displayName',
    'billingInterval',
    'unitAmount',
    'currency',
    'seatBased',
    'meteredMeterName',
    'features',
    'isActive',
    'sortOrder',
  ];
  assertRequired(plan, required, 'Plan');
  assertNoExtraKeys(plan, required, 'Plan');
  expect(typeof plan.stripePriceId).toBe('string');
  expect(typeof plan.stripeProductId).toBe('string');
  expect(typeof plan.tierName).toBe('string');
  expect(typeof plan.displayName).toBe('string');
  expect(typeof plan.billingInterval).toBe('string');
  expect(Number.isInteger(plan.unitAmount)).toBe(true);
  expect(plan.unitAmount).toBeGreaterThanOrEqual(0);
  expect(typeof plan.currency).toBe('string');
  expect(typeof plan.seatBased).toBe('boolean');
  expect(plan.meteredMeterName === null || typeof plan.meteredMeterName === 'string').toBe(true);
  expect(Array.isArray(plan.features)).toBe(true);
  plan.features.forEach((f: unknown) => expect(typeof f).toBe('string'));
  expect(typeof plan.isActive).toBe('boolean');
  expect(Number.isInteger(plan.sortOrder)).toBe(true);
}

/** CreateSubscriptionResponse — required [subscription, requiresAction], optional clientSecret. */
export function assertCreateSubscriptionResponse(body: any): void {
  const allowed = ['subscription', 'requiresAction', 'clientSecret'];
  assertRequired(body, ['subscription', 'requiresAction'], 'CreateSubscriptionResponse');
  assertNoExtraKeys(body, allowed, 'CreateSubscriptionResponse');
  expect(typeof body.requiresAction).toBe('boolean');
  if ('clientSecret' in body) expect(typeof body.clientSecret).toBe('string');
  assertBillingSubscription(body.subscription);
}

/** { subscription } wrapper — get/patch/delete subscription responses. */
export function assertSubscriptionWrapper(body: any): void {
  assertRequired(body, ['subscription'], 'SubscriptionWrapper');
  assertNoExtraKeys(body, ['subscription'], 'SubscriptionWrapper');
  assertBillingSubscription(body.subscription);
}

/** ValidationErrorBody — required [error], optional details. */
export function assertValidationErrorBody(body: any): void {
  assertRequired(body, ['error'], 'ValidationErrorBody');
  assertNoExtraKeys(body, ['error', 'details'], 'ValidationErrorBody');
  expect(typeof body.error).toBe('string');
}

/** StripeErrorBody — required [error], optional message. */
export function assertStripeErrorBody(body: any): void {
  assertRequired(body, ['error'], 'StripeErrorBody');
  assertNoExtraKeys(body, ['error', 'message'], 'StripeErrorBody');
  expect(typeof body.error).toBe('string');
  if ('message' in body) expect(typeof body.message).toBe('string');
}

/** Error — required [error] only. */
export function assertErrorBody(body: any): void {
  assertRequired(body, ['error'], 'Error');
  assertNoExtraKeys(body, ['error'], 'Error');
  expect(typeof body.error).toBe('string');
}
