"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeVerifyHandler = void 0;
const zod_1 = require("zod");
const E164_RE = /^\+[1-9]\d{6,14}$/;
const CODE_RE = /^\d{4,8}$/;
const verifySchema = zod_1.z.object({
    to: zod_1.z.string().regex(E164_RE, 'Phone number must be in E.164 format'),
    code: zod_1.z.string().regex(CODE_RE, 'Code must be 4–8 digits'),
});
function makeVerifyHandler(deps) {
    return async function verifyHandler(req, res) {
        const parsed = verifySchema.safeParse(req.body);
        if (!parsed.success) {
            // Cast to access error — zod's SafeParseReturnType discriminant is not
            // always narrowed in older ts-jest setups
            const failure = parsed;
            const msg = failure.error.errors[0]?.message ?? 'Invalid request';
            res.status(400).json({ error: msg });
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
exports.makeVerifyHandler = makeVerifyHandler;
//# sourceMappingURL=verify.js.map