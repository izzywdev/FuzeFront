/**
 * The error envelope every non-2xx response on the write surface uses —
 * mirrors `ErrorBody`/`ErrorCode`/`ErrorDetail` in openapi.yaml exactly. One
 * shared shape + helper so every route returns the same JSON structure
 * instead of re-deriving it per handler.
 */

import { Response } from 'express';
import { Scope } from '../types';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LOCKED_BY_ANCESTOR'
  | 'VERSION_CONFLICT'
  | 'SCOPE_NOT_ALLOWED'
  | 'INCOMPATIBLE_DEFINITION'
  | 'SECRET_UNAVAILABLE'
  | 'RATE_LIMITED';

export interface ErrorDetail {
  key?: string | null;
  field?: string | null;
  message: string;
  allowedValues?: unknown[] | null;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  lockedBy?: Scope | null;
  currentVersion?: string | null;
  details?: ErrorDetail[] | null;
}

export function sendError(res: Response, status: number, body: ErrorBody): void {
  res.status(status).json(body);
}
