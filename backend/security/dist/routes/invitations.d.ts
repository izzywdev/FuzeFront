declare const router: any;
/**
 * Mask an email address for safe public exposure.
 * Only the first character before '@' is preserved; the rest is replaced with '***'.
 * Example: 'user@example.com' → 'u***@example.com'
 */
export declare function maskEmail(email: string): string;
export default router;
//# sourceMappingURL=invitations.d.ts.map