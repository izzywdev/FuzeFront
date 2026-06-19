import { Express } from 'express';
export interface CreateExpressAppOptions {
    /** Extra CORS origins beyond FRONTEND_URL + localhost defaults. */
    corsOrigins?: string[];
    /** Service name used in request log lines. */
    serviceName?: string;
}
/**
 * Boilerplate Express app used by every FuzeFront backend service: helmet (CSP
 * tuned for microfrontend iframes), CORS, JSON/urlencoded parsing, request-id
 * logging. Route mounting + error/404 handlers are left to the caller (mount
 * routes, THEN call attachErrorHandlers). Zero business logic.
 */
export declare function createExpressApp(options?: CreateExpressAppOptions): Express;
/**
 * Attach the standard 500 + 404 handlers. Call AFTER all routes are mounted.
 */
export declare function attachErrorHandlers(app: Express): void;
//# sourceMappingURL=index.d.ts.map