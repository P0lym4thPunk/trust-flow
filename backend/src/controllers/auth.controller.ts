import { NextFunction, Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { AuthService } from "../services/auth.service.js";
import { AppError } from "../types/backend.types.js";

export function createAuthController(authService: AuthService) {
  return {
    getCapabilities(_req: Request, res: Response) {
      res.json(authService.getAuthCapabilities());
    },

    async startOtp(req: Request, res: Response, next: NextFunction) {
      try {
        const { email } = req.body || {};
        const clientKey = req.ip || "unknown";
        const result = await authService.startEmailOtp(email, clientKey);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async verifyOtp(req: Request, res: Response, next: NextFunction) {
      try {
        const { email, code } = req.body || {};
        const result = await authService.verifyEmailOtp(email, code);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async googleLogin(req: Request, res: Response, next: NextFunction) {
      try {
        const idToken = req.body?.idToken || req.body?.credential;
        const result = await authService.authenticateWithGoogle(idToken);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async privySync(req: Request, res: Response, next: NextFunction) {
      try {
        const authHeader = req.headers.authorization;
        const headerToken =
          authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
        const body =
          req.body && typeof req.body === "object" && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>)
            : {};
        const accessToken =
          typeof body.accessToken === "string" && body.accessToken.trim().length > 0
            ? body.accessToken
            : headerToken;
        const stellarAddress = body.stellarAddress as string | undefined;
        const disableAutoProvision = body.disableAutoProvision === true;
        const result = await authService.authenticateWithPrivy({
          accessToken: accessToken || "",
          stellarAddress,
          disableAutoProvision,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async sandboxLogin(req: Request, res: Response, next: NextFunction) {
      try {
        const persona = req.body?.persona || "alice";
        const result = await authService.authenticateSandbox(persona);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async linkWallet(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authUser) {
          return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
        }
        const { stellarAddress } = req.body || {};
        const result = await authService.linkExternalWallet(req.authUser, stellarAddress);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async createExternalWalletChallenge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authUser) {
          return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
        }
        const address = typeof req.body?.address === "string" ? req.body.address : "";
        const provider = typeof req.body?.provider === "string" ? req.body.provider : undefined;
        const result = await authService.createExternalWalletChallenge(req.authUser, address, provider);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async verifyExternalWalletChallenge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authUser) {
          return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
        }
        const { challengeId, address, signature } = req.body || {};
        const result = await authService.verifyExternalWalletChallenge(req.authUser, {
          challengeId,
          address,
          signature,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async unlinkExternalWallet(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authUser) {
          return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
        }
        const rawParam = req.params?.walletId;
        const walletId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
        const result = await authService.unlinkExternalWallet(req.authUser, walletId || "");
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async me(req: Request, res: Response, next: NextFunction) {
      try {
        const authResult = await authService.getUserFromBearerToken(req.headers.authorization);
        if (!authResult) {
          return res.json({ user: null, wallet: null });
        }
        const wallet = await authService.getWalletSnapshot(authResult.user);
        res.json({ user: authResult.user, wallet });
      } catch (err) {
        next(err);
      }
    },

    async logout(req: Request, res: Response, next: NextFunction) {
      try {
        await authService.revokeToken(req.headers.authorization);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  };
}
