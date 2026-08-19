"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityUserCreatedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.identityUserCreatedSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    firstName: zod_1.z.string().optional(),
    lastName: zod_1.z.string().optional(),
    /** Why the user was created: initial sign-up or org invitation */
    intent: zod_1.z.enum(['signup', 'org-invite']),
});
