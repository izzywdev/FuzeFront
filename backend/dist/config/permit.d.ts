interface PermitConfig {
    token: string;
    pdp: string;
    debug?: boolean;
    syncInterval?: number;
}
declare const config: PermitConfig;
export declare const isNoOpMode: boolean;
declare let permit: any;
export default permit;
export { config as permitConfig };
/**
 * Destroy the Permit SDK's underlying axios instance so its HTTP keep-alive
 * agent releases open sockets. Also destroys the Node global HTTP/HTTPS agents
 * so keep-alive sockets from any library (supertest, openid-client, etc.) are
 * released. Call this in jest afterAll to allow jest to exit without --forceExit.
 *
 * In no-op / CI mode the Permit SDK was never created, but the global agent
 * cleanup still runs — it closes any keep-alive sockets that supertest or other
 * HTTP libraries left open during the test suite.
 */
export declare function destroyPermitClient(): void;
//# sourceMappingURL=permit.d.ts.map