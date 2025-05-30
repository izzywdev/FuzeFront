import { Request, Response, NextFunction } from 'express'
import { User } from '@frontfuse/shared'
interface AuthenticatedRequest extends Request {
  user?: User
}
export declare const authenticateToken: (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<Response<any, Record<string, any>> | undefined>
export declare const requireRole: (
  roles: string[]
) => (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Response<any, Record<string, any>> | undefined
export {}
//# sourceMappingURL=auth.d.ts.map
