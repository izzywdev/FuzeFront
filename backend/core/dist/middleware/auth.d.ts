import { Request, Response, NextFunction } from 'express';
/**
 * JWT auth middleware shared by every FuzeFront backend service. Depends only on
 * `db` (the @fuzefront/core knex singleton, configured by the consuming service)
 * and `JWT_SECRET`. No Permit / business logic — that stays in the owning
 * service. Verifies the bearer token and loads the user row into `req.user`.
 */
export declare const authenticateToken: (req: Request, res: Response, next: NextFunction) => Promise<any>;
export declare const requireRole: (roles: string[]) => (req: Request, res: Response, next: NextFunction) => any;
//# sourceMappingURL=auth.d.ts.map