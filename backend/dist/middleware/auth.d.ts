import { Request, Response, NextFunction } from 'express';
export declare const authenticateToken: (req: Request, res: Response, next: NextFunction) => Promise<any>;
export declare const requireRole: (roles: string[]) => (req: Request, res: Response, next: NextFunction) => any;
//# sourceMappingURL=auth.d.ts.map