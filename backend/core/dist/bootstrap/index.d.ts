import { Express, Request, Response, NextFunction } from 'express';
export interface CreateExpressAppOptions {
    /** Extra CORS origins beyond FRONTEND_URL + localhost defaults. */
    corsOrigins?: string[];
    /** Service name used in request log lines. */
    serviceName?: string;
    /**
     * Middleware mounted BEFORE helmet/cors/body-parsers/request-logging below —
     * for anything that must see every request, including one helmet/cors itself
     * rejects (e.g. @fuzefront/telemetry's tracingMiddleware()). A caller cannot
     * achieve this by calling `app.use()` on the returned Express instance: this
     * function has already registered its own stack by the time it returns, and
     * Express runs middleware in registration order, so anything added afterward
     * runs LAST, not first.
     */
    preMiddleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
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