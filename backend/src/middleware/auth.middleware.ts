import { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/auth.service.js";
import { AppError, SessionRecord, UserRecord } from "../types/backend.types.js";

export interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
  authSession?: SessionRecord;
}

export function createAuthMiddleware(authService: AuthService) {
  return async function requireAuth(
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const authResult = await authService.getUserFromBearerToken(req.headers.authorization);
      if (!authResult) {
        return next(
          new AppError(401, "UNAUTHORIZED", "Authentication required. Provide a valid Bearer session token.")
        );
      }
      req.authUser = authResult.user;
      req.authSession = authResult.session;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  console.error("[TrustFlow Backend] Unexpected error:", err);
  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
}
