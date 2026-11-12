import { Request, Response } from "express";
import { agreementService } from "../services/agreement.service.js";
import { computeCanonicalHash } from "../services/hash.service.js";

export function handleGetAllAgreements(_req: Request, res: Response) {
  const list = agreementService.getAll();
  res.json(list);
}

export function handleGetAgreementById(req: Request, res: Response) {
  const agreement = agreementService.getById(req.params.id);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }
  res.json(agreement);
}

export async function handleCreateOrUpdateAgreement(req: Request, res: Response) {
  const payload = req.body;
  if (!payload || !payload.id || !payload.title) {
    return res.status(400).json({ error: "Invalid agreement payload" });
  }

  // Compute and ensure deterministic canonical hash
  if (payload.terms) {
    const computedHash = await computeCanonicalHash(payload.terms);
    payload.canonicalHash = computedHash;
  }

  const saved = agreementService.save(payload);
  res.json(saved);
}

export async function handleAcceptAgreement(req: Request, res: Response) {
  const { id } = req.params;
  const { role, actor, canonicalHash } = req.body; // "PAYER" or "RECIPIENT"
  const agreement = agreementService.getById(id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  if (role !== "PAYER" && role !== "RECIPIENT") {
    return res.status(400).json({ error: "Invalid role: must be PAYER or RECIPIENT" });
  }

  // Verify canonical hash matches stored agreement terms
  if (canonicalHash) {
    const serverCanonicalHash = agreement.canonicalHash || (await computeCanonicalHash(agreement.terms));
    if (canonicalHash !== serverCanonicalHash) {
      return res.status(400).json({
        error: "Canonical hash mismatch: terms have been modified or tampered with.",
        expected: serverCanonicalHash,
        received: canonicalHash,
      });
    }
  }

  if (role === "PAYER") {
    agreement.payerAccepted = true;
  } else if (role === "RECIPIENT") {
    agreement.recipientAccepted = true;
  }

  // Advance lifecycle when both parties accept
  if (agreement.payerAccepted && agreement.recipientAccepted) {
    agreement.status = "READY_FOR_FUNDING";
  }

  const updated = agreementService.addActivity(id, {
    actor: actor || (role === "PAYER" ? agreement.terms.payer : agreement.terms.recipient),
    actorRole: role,
    type: "ACCEPTED",
    title: `Agreement accepted by ${role.toLowerCase()}`,
    description: `Terms version ${agreement.version} accepted with verified canonical hash ${agreement.canonicalHash?.slice(0, 8)}...`,
  });

  res.json(updated);
}
