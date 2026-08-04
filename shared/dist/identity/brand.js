"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityError = void 0;
/** Raised whenever a value fails to be a valid id for the expected type. */
class IdentityError extends Error {
    constructor(code, expectedType, message) {
        super(message);
        this.name = 'IdentityError';
        this.code = code;
        this.expectedType = expectedType;
    }
}
exports.IdentityError = IdentityError;
