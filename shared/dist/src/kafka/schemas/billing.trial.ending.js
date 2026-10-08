"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingTrialEndingSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingTrialEndingSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    entityType: zod_1.z.enum(['user', 'organization']),
    /** ISO-8601 datetime when the trial period ends. */
    trialEnd: zod_1.z.string().datetime(),
    /** Stripe / catalogue tier name (e.g. 'professional'). */
    planTier: zod_1.z.string(),
});
