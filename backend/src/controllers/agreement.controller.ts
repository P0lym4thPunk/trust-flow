import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { AgreementService } from "../services/agreement.service.js";
import { AppError } from "../types/backend.types.js";

export function createAgreementController(agreementService: AgreementService) {
  function requireUser(req: AuthenticatedRequest) {
    if (!req.authUser) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
    }
    return req.authUser;
  }

  return {
    async listAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const list = await agreementService.listForUser(user);
        res.json(list);
      } catch (err) {
        next(err);
      }
    },

    async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const agreement = await agreementService.getForUser(user, req.params.id);
        res.json(agreement);
      } catch (err) {
        next(err);
      }
    },

    async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const created = await agreementService.createAgreement(user, req.body);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },

    async accept(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { role, canonicalHash, expectedVersion } = req.body || {};
        const updated = await agreementService.acceptAgreement(user, req.params.id, {
          role,
          canonicalHash,
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async requestChanges(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { reason, updatedTerms, expectedVersion } = req.body || {};
        const updated = await agreementService.requestChanges(user, req.params.id, {
          reason,
          updatedTerms,
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async submitFulfilment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { notes, evidenceUrl, expectedVersion } = req.body || {};
        const updated = await agreementService.submitFulfilment(user, req.params.id, {
          notes,
          evidenceUrl,
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async approve(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { expectedVersion } = req.body || {};
        const updated = await agreementService.approveFulfilment(user, req.params.id, {
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async requestCancellation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { expectedVersion } = req.body || {};
        const updated = await agreementService.requestCancellation(user, req.params.id, {
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async withdrawCancellation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { expectedVersion } = req.body || {};
        const updated = await agreementService.withdrawCancellation(user, req.params.id, {
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    async confirmCancellation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const user = requireUser(req);
        const { expectedVersion } = req.body || {};
        const updated = await agreementService.confirmCancellation(user, req.params.id, {
          expectedVersion,
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },

    blockPhase2Financial(_req: AuthenticatedRequest, _res: Response, next: NextFunction) {
      next(
        new AppError(
          501,
          "PHASE_2_REQUIRED",
          "On-chain funding, release, and refund execution require Phase 2 Trustless Work integration and cannot be performed client-side."
        )
      );
    },
  };
}
