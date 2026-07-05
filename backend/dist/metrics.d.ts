import type { Express, Request, Response, NextFunction } from 'express';
interface MetricsHandle {
    /** Express middleware that records request count + duration. */
    middleware: (req: Request, res: Response, next: NextFunction) => void;
    /** Registers GET /metrics on the app. */
    registerEndpoint: (app: Express) => void;
}
export declare function setupMetrics(): MetricsHandle;
export {};
//# sourceMappingURL=metrics.d.ts.map