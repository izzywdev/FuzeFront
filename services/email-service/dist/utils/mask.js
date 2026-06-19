"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskEmail = void 0;
/**
 * Mask an email address so PII does not appear in production logs.
 * alice@example.com → a***@example.com
 */
function maskEmail(email) {
    const atIdx = email.indexOf('@');
    if (atIdx <= 0)
        return '***';
    const local = email.slice(0, atIdx);
    const domain = email.slice(atIdx); // includes '@'
    const visible = local[0];
    return `${visible}***${domain}`;
}
exports.maskEmail = maskEmail;
//# sourceMappingURL=mask.js.map