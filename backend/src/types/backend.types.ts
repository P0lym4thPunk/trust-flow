/**
 * TrustFlow Backend Types
 * Off-chain application models, API contracts, and integration interfaces.
 */

export type TransactionType = "WORK" | "PROTECTED_PAYMENT" | "CONDITIONAL_DISBURSEMENT";

export type AgreementStatus =
  | "DRAFT"
  | "AWAITING_RECIPIENT_ACCEPTANCE"
  | "AWAITING_PAYER_ACCEPTANCE"
  | "READY_FOR_FUNDING"
  | "FUNDING_PENDING"
  | "FUNDED"
  | "FULFILMENT_SUBMITTED"
  | "AWAITING_APPROVAL"
  | "RELEASE_PENDING"
  | "COMPLETED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "DISPUTED";

export interface AgreementTerms {
  amount: string;
  asset: "USDC" | "XLM";
  payer: string;
  recipient: string;
  approver: string;
  title: string;
  description: string;
  deliverables: string[];
  condition: string;
  cancellationTerms: string;
  deadline: string;
  contractId?: string;
  domain?: string;
  network?: "testnet" | "mainnet";
  version: number;
}

export interface ActivityEvent {
  id: string;
  agreementId: string;
  timestamp: string;
  actor: string;
  actorRole: "PAYER" | "RECIPIENT" | "APPROVER" | "SYSTEM";
  type:
    | "CREATED"
    | "UPDATED"
    | "ACCEPTED"
    | "FUNDING_INITIATED"
    | "FUNDED"
    | "FULFILMENT_SUBMITTED"
    | "APPROVED"
    | "RELEASED"
    | "CANCEL_REQUESTED"
    | "CANCELLED"
    | "REFUNDED";
  title: string;
  description: string;
  txHash?: string;
  evidenceUrl?: string;
}

export interface AgreementRecord {
  id: string;
  escrowId?: number | string;
  trustlessWorkEscrowId?: string;
  transactionType: TransactionType;
  title: string;
  description: string;
  status: AgreementStatus;
  cancelRequest: "NONE" | "BY_PAYER" | "BY_RECIPIENT" | "MUTUAL_AGREED";
  payerAccepted: boolean;
  recipientAccepted: boolean;
  version: number;
  canonicalHash: string;
  terms: AgreementTerms;
  createdAt: string;
  updatedAt: string;
  fundedAt?: string;
  fundingTxHash?: string;
  completedAt?: string;
  releaseTxHash?: string;
  evidence?: {
    submittedAt: string;
    description: string;
    links: string[];
  };
  activity: ActivityEvent[];
}

export interface UserProfile {
  id: string;
  stellarAddress: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  authProvider: "stellar-wallet" | "pollar-privy" | "simulated";
}
