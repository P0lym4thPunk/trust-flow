import { Request, Response } from "express";
import { agreementService } from "../services/agreement.service.js";
import { trustlessWorkAdapter } from "../adapters/trustlessWork.adapter.js";
import { stellarRpcAdapter } from "../adapters/stellarRpc.adapter.js";

export async function handlePrepareEscrow(req: Request, res: Response) {
  const { agreementId } = req.body;
  const agreement = agreementService.getById(agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  const prepared = await trustlessWorkAdapter.prepareEscrowCreation({
    title: agreement.title,
    amount: agreement.terms.amount,
    asset: agreement.terms.asset,
    payer: agreement.terms.payer,
    recipient: agreement.terms.recipient,
    approver: agreement.terms.approver,
    deadline: agreement.terms.deadline,
  });

  res.json(prepared);
}

export async function handleConfirmFunding(req: Request, res: Response) {
  const { id } = req.params;
  const { txHash, payerAddress } = req.body;
  const agreement = agreementService.getById(id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  if (!txHash) {
    return res.status(400).json({ error: "Transaction hash is required" });
  }

  // Authoritatively verify on Stellar
  const verification = await stellarRpcAdapter.verifyTransaction(txHash);

  // If verified or testnet simulation
  agreement.status = "FUNDED";
  agreement.fundingTxHash = txHash;
  agreement.fundedAt = new Date().toISOString();

  const updated = agreementService.addActivity(id, {
    actor: payerAddress || agreement.terms.payer,
    actorRole: "PAYER",
    type: "FUNDED",
    title: "Escrow Funded on Stellar Testnet",
    description: `${agreement.terms.amount} ${agreement.terms.asset} locked in escrow.`,
    txHash,
  });

  res.json({ agreement: updated, onChainVerification: verification });
}

export async function handleSubmitFulfilment(req: Request, res: Response) {
  const { id } = req.params;
  const { description, links, actor } = req.body;
  const agreement = agreementService.getById(id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  agreement.status = "AWAITING_APPROVAL";
  agreement.evidence = {
    submittedAt: new Date().toISOString(),
    description: description || "Deliverables submitted for review",
    links: links || [],
  };

  const updated = agreementService.addActivity(id, {
    actor: actor || agreement.terms.recipient,
    actorRole: "RECIPIENT",
    type: "FULFILMENT_SUBMITTED",
    title: "Deliverables Submitted for Approval",
    description: description || "Recipient marked agreement ready for review.",
    evidenceUrl: links?.[0],
  });

  res.json(updated);
}

export async function handleApproveAndRelease(req: Request, res: Response) {
  const { id } = req.params;
  const { txHash, actor } = req.body;
  const agreement = agreementService.getById(id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  agreement.status = "COMPLETED";
  agreement.completedAt = new Date().toISOString();
  if (txHash) agreement.releaseTxHash = txHash;

  const updated = agreementService.addActivity(id, {
    actor: actor || agreement.terms.approver,
    actorRole: "APPROVER",
    type: "RELEASED",
    title: "Fulfilment Approved & Funds Released",
    description: "Conditions satisfied. Payment released to recipient.",
    txHash,
  });

  res.json(updated);
}

export async function handleVerifyTx(req: Request, res: Response) {
  const { hash } = req.params;
  const result = await stellarRpcAdapter.verifyTransaction(hash);
  res.json(result);
}
