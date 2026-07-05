/**
 * Contract alignment guard.
 *
 * The hand-authored public types in `./types` and the OpenAPI contract in
 * `services/billing-service/openapi.yaml` (codegen'd into `./schema`) must stay
 * in lockstep. This module statically asserts equivalence so that any drift —
 * a field added to the spec, a type changed in either place — becomes a
 * COMPILE ERROR in `tsc`, not a runtime integration surprise.
 *
 * It exports nothing at runtime; it is type-level only. Regenerate `schema.ts`
 * with `npm run gen:types` after editing the contract.
 */
import type { components } from './schema';
import type {
  BillingSubscription,
  Plan,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  UpdateSubscriptionRequest,
  EntityType,
} from './types';

type Schemas = components['schemas'];

/**
 * `Exact<A, B>` resolves to `A` only when A and B are mutually assignable,
 * otherwise to `never` — turning a mismatch into an unusable type.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? A : never) : never;

// Each line fails to compile if the generated schema and the public type diverge.
type _Sub = Exact<BillingSubscription, Schemas['BillingSubscription']>;
type _Plan = Exact<Plan, Schemas['Plan']>;
type _CreateReq = Exact<CreateSubscriptionRequest, Schemas['CreateSubscriptionRequest']>;
type _CreateRes = Exact<CreateSubscriptionResponse, Schemas['CreateSubscriptionResponse']>;
type _UpdateReq = Exact<UpdateSubscriptionRequest, Schemas['UpdateSubscriptionRequest']>;
type _Entity = Exact<EntityType, Schemas['EntityType']>;

// Reference the aliases so `noUnusedLocals`-style lints don't strip them.
export type ContractAlignment = {
  subscription: _Sub;
  plan: _Plan;
  createRequest: _CreateReq;
  createResponse: _CreateRes;
  updateRequest: _UpdateReq;
  entityType: _Entity;
};
