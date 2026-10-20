"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingPaymentFailedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingPaymentFailedSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    entityType: zod_1.z.enum(['user', 'organization']),
    /** Stripe invoice ID (e.g. 'in_1AbcDef...'). */
    invoiceId: zod_1.z.string(),
    /** Amount due in the currency's minor unit (cents for USD). */
    amountDue: zod_1.z.number().int().nonnegative(),
    /** ISO-4217 lowercase currency code (e.g. 'usd'). */
    currency: zod_1.z.string().min(3).max(3),
});
