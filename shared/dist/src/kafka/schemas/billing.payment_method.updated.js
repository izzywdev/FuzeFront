"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingPaymentMethodUpdatedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingPaymentMethodUpdatedSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    entityType: zod_1.z.enum(['user', 'organization']),
    stripeCustomerId: zod_1.z.string(),
    paymentMethodId: zod_1.z.string(),
    /** e.g. 'visa', 'mastercard' — omitted for non-card payment methods. */
    brand: zod_1.z.string().optional(),
    last4: zod_1.z.string().optional(),
});
