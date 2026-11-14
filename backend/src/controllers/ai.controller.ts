import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { AiService } from "../services/ai.service.js";

export function createAiController(aiService: AiService) {
  return {
    getInfo(_req: AuthenticatedRequest, res: Response) {
      res.json(aiService.getModelInfo());
    },

    async handleDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const { prompt, transactionType = "WORK", userRole = "PAYER" } = req.body || {};
        const actorKey = req.authUser?.id || req.ip || "anonymous";
        const result = await aiService.draftAgreement(prompt, transactionType, userRole, actorKey);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },

    async handleCheck(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const { terms } = req.body || {};
        const actorKey = req.authUser?.id || req.ip || "anonymous";
        const result = await aiService.checkAgreement(terms, actorKey);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  };
}
