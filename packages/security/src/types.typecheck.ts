/**
 * Compile-time assertions (run by `npm run type-check`; not part of the bundle).
 */
import type { MfaVerifyRequest } from './types';

export const factorProof: MfaVerifyRequest = { challengeId: 'c', factorId: 'f', code: '123456' };
export const recoveryProof: MfaVerifyRequest = { challengeId: 'c', recoveryCode: 'abcd-efgh' };

// @ts-expect-error a mixed body must not type-check
export const mixed: MfaVerifyRequest = { challengeId: 'c', factorId: 'f', code: '1', recoveryCode: 'r' };
// @ts-expect-error recovery proof forbids factorId
export const recoveryWithFactor: MfaVerifyRequest = { challengeId: 'c', recoveryCode: 'r', factorId: 'f' };
// @ts-expect-error neither shape
export const neither: MfaVerifyRequest = { challengeId: 'c' };
