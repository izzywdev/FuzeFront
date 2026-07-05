declare const router: any;
/**
 * Wait for all in-flight selfHealProvisioningOnLogin promises to settle.
 * Call this in test afterAll BEFORE closeDatabase() to prevent tarn.js
 * pool.destroy() from hanging on borrowed connections.
 */
export declare function drainProvisioningQueue(timeoutMs?: number): Promise<void>;
export default router;
//# sourceMappingURL=auth.d.ts.map