/**
 * TrustFlow Backend Types
 * Unified Phase 1 domain, authentication, repository, and API contracts.
 */

export type TransactionType = "WORK" | "PROTECTED_PAYMENT" | "CONDITIONAL_DISBURSEMENT";

export type AgreementStatus =
  | "DRAFT"
  | "CREATED"
  | "READY_FOR_FUNDING"
  | "FUNDED"
  | "FULFILMENT_SUBMITTED"
  | "APPROVED"
  | "RELEASED"
  | "REFUNDED"
  | "CANCELLED"
  | "DISPUTED";

export type CancelRequestState = "NONE" | "REQUESTED_BY_PAYER" | "REQUESTED_BY_RECIPIENT";

export type AssetSymbol = "XLM" | "USDC";

export interface AgreementTerms {
  amount: string;
  asset: AssetSymbol;
  payer: string;
  recipient: string;
  approver: string;
  title: string;
  description: string;
  deliverables: string[];
  condition: string;
  cancellationTerms: string;
  deadline: string;
  contractId: string;
  domain: string;
  network: string;
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
    | "CHANGES_REQUESTED"
    | "ACCEPTED"
    | "FUNDED"
    | "FULFILMENT_SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "RELEASED"
    | "REFUNDED"
    | "CANCEL_REQUESTED"
    | "CANCEL_CONFIRMED"
    | "CANCELLED";
  title: string;
  description: string;
  txHash?: string;
  evidenceUrl?: string;
}

export interface AgreementRecord {
  id: string;
  escrowId?: number;
  trustlessWorkEscrowId?: string;
  transactionType: TransactionType;
  title: string;
  description: string;
  terms: AgreementTerms;
  canonicalHash: string;
  version: number;
  status: AgreementStatus;
  cancelRequest: CancelRequestState;
  payerAccepted: boolean;
  recipientAccepted: boolean;
  fulfilmentHash?: string;
  fulfilmentNotes?: string;
  fulfilmentEvidenceUrl?: string;
  rejectionReasonHash?: string;
  rejectionReason?: string;
  fundingTxHash?: string;
  releaseTxHash?: string;
  refundTxHash?: string;
  createdByUserId?: string;
  isSandbox?: boolean;
  createdAt: string;
  updatedAt: string;
  fundedAt?: string;
  completedAt?: string;
  activity: ActivityEvent[];
}

export type AuthProvider = "email_otp" | "google" | "privy" | "dev_sandbox";
export type WalletCustody = "none" | "privy_embedded" | "external_wallet" | "dev_sandbox";
export type WalletRecordStatus = "active" | "unlinked";
export type WalletVerificationMethod =
  | "privy_embedded"
  | "sep53"
  | "dev_sandbox"
  | "legacy_unverified";

export interface UserWalletRecord {
  id: string;
  address: string;
  custody: WalletCustody;
  provider: string;
  privyWalletId?: string | null;
  verificationMethod: WalletVerificationMethod;
  verifiedAt: string;
  linkedAt: string;
  unlinkedAt?: string | null;
  status: WalletRecordStatus;
  isPrimary: boolean;
}

export interface UserRecord {
  id: string;
  email: string | null;
  displayName: string;
  avatar: string;
  provider: AuthProvider;
  authVerified: boolean;
  providerSubject?: string;
  stellarAddress: string | null;
  walletCustody: WalletCustody;
  wallets?: UserWalletRecord[];
  primaryWalletAddress?: string | null;
  isSandbox: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export type ProvisioningStatus = "pending" | "ambiguous" | "completed" | "failed";

export interface ProvisioningRecord {
  privySub: string;
  status: ProvisioningStatus;
  idempotencyKey: string;
  idempotencyCreatedAt: string;
  externalId: string;
  walletId?: string | null;
  stellarAddress?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface WalletChallengeRecord {
  id: string;
  userId: string;
  address: string;
  provider: string;
  network: "testnet";
  domain: string;
  nonce: string;
  message: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string | null;
}

export interface SessionRecord {
  token: string;
  userId: string;
  provider: AuthProvider;
  isSandbox: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface OtpRecord {
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
