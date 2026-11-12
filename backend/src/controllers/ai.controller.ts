import { Request, Response } from "express";
import { draftAgreement, checkAgreement } from "../services/ai.service.js";

export async function handleDraft(req: Request, res: Response) {
  const { prompt, transactionType = "WORK", userRole = "PAYER" } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const result = await draftAgreement(prompt, transactionType, userRole);
  res.json(result);
}

export async function handleCheck(req: Request, res: Response) {
  const { terms } = req.body;
  if (!terms) {
    return res.status(400).json({ error: "Agreement terms are required" });
  }

  const result = await checkAgreement(terms);
  res.json(result);
}
