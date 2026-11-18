import crypto from "crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { AgreementRepository } from "../repositories/agreement.repository.js";
import {
  ActivityEvent,
  AgreementRecord,
  AgreementStatus,
  AgreementTerms,
  AppError,
  TransactionType,
  UserRecord,
} from "../types/backend.types.js";
import {
  AuthRepository,
  getActiveUserWalletAddresses,
  getHistoricalUserWalletAddresses,
} from "../repositories/auth.repository.js";
import { KeyedOperationLock } from "../repositories/operationLock.js";
import { computeCanonicalHash } from "./hash.service.js";

const TERMINAL_AGREEMENT_STATUSES = new Set<AgreementStatus>([
  "RELEASED",
  "REFUNDED",
  "CANCELLED",
]);

const VALID_TRANSACTION_TYPES = new Set<TransactionType>([
  "WORK",
  "PROTECTED_PAYMENT",
  "CONDITIONAL_DISBURSEMENT",
]);

const MAX_STROOP_UNITS = 999_999_999_999_999n;
const MIN_STROOP_UNITS = 1n;

function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (!address.startsWith("G") || address.length !== 56) return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

function validateAmountStr(amountStr: string): void {
  if (typeof amountStr !== "string" || !/^(0|[1-9]\d{0,7})(\.\d{1,7})?$/.test(amountStr)) {
    throw new AppError(
      400,
      "INVALID_AMOUNT",
      `Invalid payment amount "${amountStr}". Must be a positive decimal with up to 7 decimal places.`
    );
  }
  const [whole, frac = ""] = amountStr.split(".");
  const paddedFrac = frac.padEnd(7, "0");
  const units = BigInt(whole) * 10_000_000n + BigInt(paddedFrac);
  if (units < MIN_STROOP_UNITS || units > MAX_STROOP_UNITS) {
    throw new AppError(400, "AMOUNT_OUT_OF_BOUNDS", "Payment amount must be greater than zero.");
  }
}

function validateTerms(terms: AgreementTerms): void {
  if (!terms || typeof terms !== "object") {
    throw new AppError(400, "INVALID_TERMS", "Agreement terms are required.");
  }

  validateAmountStr(terms.amount);

  if (terms.asset !== "USDC" && terms.asset !== "XLM") {
    throw new AppError(400, "INVALID_ASSET", 'Asset must be "USDC" or "XLM".');
  }

  if (!isValidStellarAddress(terms.payer)) {
    throw new AppError(400, "INVALID_PAYER_ADDRESS", "Payer must be a valid Stellar address starting with G.");
  }
  if (!isValidStellarAddress(terms.recipient)) {
    throw new AppError(400, "INVALID_RECIPIENT_ADDRESS", "Recipient must be a valid Stellar address starting with G.");
  }
  if (!isValidStellarAddress(terms.approver)) {
    throw new AppError(400, "INVALID_APPROVER_ADDRESS", "Approver must be a valid Stellar address starting with G.");
  }

  if (terms.payer === terms.recipient) {
    throw new AppError(400, "SELF_PAYMENT_FORBIDDEN", "Payer and recipient cannot be the same account.");
  }

  if (!terms.title || typeof terms.title !== "string" || !terms.title.trim()) {
    throw new AppError(400, "INVALID_TITLE", "Agreement title is required.");
  }
  if (!terms.description || typeof terms.description !== "string" || !terms.description.trim()) {
    throw new AppError(400, "INVALID_DESCRIPTION", "Agreement description is required.");
  }
  if (!Array.isArray(terms.deliverables) || terms.deliverables.filter((d) => String(d).trim()).length === 0) {
    throw new AppError(400, "INVALID_DELIVERABLES", "At least one deliverable is required.");
  }
  if (!terms.condition || typeof terms.condition !== "string" || !terms.condition.trim()) {
    throw new AppError(400, "INVALID_CONDITION", "Release condition is required.");
  }
  if (!terms.deadline || Number.isNaN(Date.parse(terms.deadline))) {
    throw new AppError(400, "INVALID_DEADLINE", "A valid ISO-8601 deadline is required.");
  }
}

export class AgreementService {
  private readonly operationLock: KeyedOperationLock;

  constructor(
    private readonly repo: AgreementRepository,
    private readonly authRepo?: AuthRepository,
    operationLock?: KeyedOperationLock
  ) {
    this.operationLock = operationLock || new KeyedOperationLock();
  }

  private getUserIdentities(user: UserRecord): string[] {
    return Array.from(new Set([user.id, ...getActiveUserWalletAddresses(user)]));
  }

  private getUserHistoricalIdentities(user: UserRecord): string[] {
    return Array.from(new Set([user.id, ...getHistoricalUserWalletAddresses(user)]));
  }

  private userMatchesAddress(user: UserRecord, partyAddress: string): boolean {
    return this.getUserIdentities(user).includes(partyAddress);
  }

  private assertParticipant(user: UserRecord, agreement: AgreementRecord): void {
    const identities = TERMINAL_AGREEMENT_STATUSES.has(agreement.status)
      ? this.getUserHistoricalIdentities(user)
      : this.getUserIdentities(user);
    const isPayer = identities.includes(agreement.terms.payer);
    const isRecipient = identities.includes(agreement.terms.recipient);
    const isApprover = identities.includes(agreement.terms.approver);
    if (!isPayer && !isRecipient && !isApprover) {
      throw new AppError(
        403,
        "FORBIDDEN_NOT_PARTICIPANT",
        "You are not a participant on this agreement."
      );
    }
  }

  private makeActivity(
    agreementId: string,
    actor: string,
    actorRole: ActivityEvent["actorRole"],
    type: ActivityEvent["type"],
    title: string,
    description: string,
    txHash?: string
  ): ActivityEvent {
    return {
      id: `act-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      agreementId,
      timestamp: new Date().toISOString(),
      actor,
      actorRole,
      type,
      title,
      description,
      ...(txHash ? { txHash } : {}),
    };
  }

  public async listForUser(user: UserRecord): Promise<AgreementRecord[]> {
    const all = await this.repo.findAll();
    const activeIdentities = new Set(this.getUserIdentities(user));
    const historicalIdentities = new Set(this.getUserHistoricalIdentities(user));
    return all.filter((agr) => {
      const identities = TERMINAL_AGREEMENT_STATUSES.has(agr.status)
        ? historicalIdentities
        : activeIdentities;
      return (
        identities.has(agr.terms.payer) ||
        identities.has(agr.terms.recipient) ||
        identities.has(agr.terms.approver)
      );
    });
  }

  public async getForUser(user: UserRecord, id: string): Promise<AgreementRecord> {
    const agreement = await this.repo.findById(id);
    if (!agreement) {
      throw new AppError(404, "AGREEMENT_NOT_FOUND", "Agreement not found.");
    }
    this.assertParticipant(user, agreement);
    return agreement;
  }

  public async createAgreement(
    user: UserRecord,
    input: {
      id?: string;
      transactionType?: TransactionType;
      title?: string;
      description?: string;
      status?: string;
      terms: AgreementTerms;
      fundingTxHash?: string;
      releaseTxHash?: string;
      refundTxHash?: string;
      fundedAt?: string;
      completedAt?: string;
    }
  ): Promise<AgreementRecord> {
    if (!input || !input.terms) {
      throw new AppError(400, "INVALID_PAYLOAD", "Agreement terms are required.");
    }

    // Explicitly block client-spoofed financial or post-acceptance states on creation
    if (
      input.status &&
      input.status !== "DRAFT" &&
      input.status !== "CREATED"
    ) {
      throw new AppError(
        403,
        "FORBIDDEN_INITIAL_STATUS",
        `Agreements cannot be created directly with status "${input.status}". Financial states require Phase 2 verified escrow execution.`
      );
    }

    if (input.fundingTxHash || input.releaseTxHash || input.refundTxHash || input.fundedAt || input.completedAt) {
      throw new AppError(
        403,
        "FORBIDDEN_FINANCIAL_FIELDS",
        "Client-submitted funding, release, or refund fields are not permitted."
      );
    }

    const transactionType: TransactionType = input.transactionType || "WORK";
    if (!VALID_TRANSACTION_TYPES.has(transactionType)) {
      throw new AppError(400, "INVALID_TRANSACTION_TYPE", "Unsupported transaction type.");
    }

    const normalizedTerms: AgreementTerms = {
      ...input.terms,
      title: (input.terms.title || input.title || "").trim(),
      description: (input.terms.description || input.description || "").trim(),
      deliverables: Array.isArray(input.terms.deliverables)
        ? input.terms.deliverables.map((d) => String(d).trim()).filter(Boolean)
        : [],
      condition: String(input.terms.condition || "").trim(),
      cancellationTerms:
        String(input.terms.cancellationTerms || "").trim() ||
        "Mutual cancellation permitted prior to approval, or agreed review if past deadline",
      version: 1,
    };

    validateTerms(normalizedTerms);

    const id = input.id && /^agr-[a-zA-Z0-9_-]{4,64}$/.test(input.id)
      ? input.id
      : `agr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const initialStatus: AgreementStatus = input.status === "DRAFT" ? "DRAFT" : "CREATED";
    const canonicalHash = await computeCanonicalHash(normalizedTerms);

    return this.operationLock.withLock(`user:${user.id}`, async () => {
      const freshUser = this.authRepo ? (await this.authRepo.findUserById(user.id)) ?? user : user;

      // Revalidate active wallet ownership under lock right before commit
      const isPayer = this.userMatchesAddress(freshUser, normalizedTerms.payer);
      const isRecipient = this.userMatchesAddress(freshUser, normalizedTerms.recipient);
      if (!isPayer && !isRecipient) {
        throw new AppError(
          403,
          "FORBIDDEN_CREATOR_NOT_PARTY",
          "Authenticated user must match the agreement payer or recipient wallet address."
        );
      }

      const nowIso = new Date().toISOString();
      const matchedAddr = isPayer ? normalizedTerms.payer : normalizedTerms.recipient;
      const actorAddr = matchedAddr || freshUser.stellarAddress || freshUser.id;

      const payerAccepted = initialStatus === "CREATED" && isPayer;
      const recipientAccepted = initialStatus === "CREATED" && isRecipient && !isPayer;

      const record: AgreementRecord = {
        id,
        transactionType,
        title: normalizedTerms.title,
        description: normalizedTerms.description,
        terms: normalizedTerms,
        canonicalHash,
        version: 1,
        status: initialStatus,
        cancelRequest: "NONE",
        payerAccepted,
        recipientAccepted,
        createdByUserId: freshUser.id,
        isSandbox: freshUser.isSandbox,
        createdAt: nowIso,
        updatedAt: nowIso,
        activity: [
          this.makeActivity(
            id,
            actorAddr,
            isPayer ? "PAYER" : "RECIPIENT",
            "CREATED",
            isPayer ? "Payment agreement created" : "Payment request created",
            `Drafted for ${normalizedTerms.amount} ${normalizedTerms.asset}. Awaiting counterparty review.`
          ),
        ],
      };

      return this.repo.create(record);
    });
  }

  public async acceptAgreement(
    user: UserRecord,
    id: string,
    params: { role?: string; canonicalHash?: string; expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);

    if (existing.status !== "CREATED") {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `Agreement cannot be accepted in status "${existing.status}".`
      );
    }

    const role = params.role;
    if (role !== "PAYER" && role !== "RECIPIENT") {
      throw new AppError(400, "INVALID_ROLE", "Invalid role: must be PAYER or RECIPIENT.");
    }

    const expectedParty = role === "PAYER" ? existing.terms.payer : existing.terms.recipient;
    if (!this.userMatchesAddress(user, expectedParty)) {
      throw new AppError(
        403,
        "FORBIDDEN_ROLE_MISMATCH",
        `Only the designated ${role.toLowerCase()} (${expectedParty}) can record ${role} acceptance.`
      );
    }

    const serverCanonicalHash = await computeCanonicalHash(existing.terms);
    if (!params.canonicalHash || params.canonicalHash !== serverCanonicalHash) {
      throw new AppError(
        400,
        "CANONICAL_HASH_MISMATCH",
        "Canonical hash mismatch: terms have been modified or hash verification failed.",
        { expected: serverCanonicalHash, received: params.canonicalHash || null }
      );
    }

    return this.repo.update(id, params.expectedVersion, (agr) => {
      if (agr.status !== "CREATED") {
        throw new AppError(409, "INVALID_STATE_TRANSITION", `Agreement is no longer in CREATED state.`);
      }
      if (role === "PAYER" && agr.payerAccepted) {
        throw new AppError(409, "ALREADY_ACCEPTED", "Payer has already accepted these terms.");
      }
      if (role === "RECIPIENT" && agr.recipientAccepted) {
        throw new AppError(409, "ALREADY_ACCEPTED", "Recipient has already accepted these terms.");
      }

      if (role === "PAYER") agr.payerAccepted = true;
      if (role === "RECIPIENT") agr.recipientAccepted = true;

      if (agr.payerAccepted && agr.recipientAccepted) {
        agr.status = "READY_FOR_FUNDING";
      }

      agr.canonicalHash = serverCanonicalHash;
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          role,
          "ACCEPTED",
          `Agreement accepted by ${role.toLowerCase()}`,
          `Terms version ${agr.terms.version} accepted with verified canonical hash ${serverCanonicalHash.slice(0, 8)}...`
        )
      );
      return agr;
    });
  }

  public async requestChanges(
    user: UserRecord,
    id: string,
    params: {
      reason?: string;
      updatedTerms?: Partial<AgreementTerms>;
      expectedVersion?: number;
    }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);

    // Post-funding deliverable revision request by approver
    if (existing.status === "FULFILMENT_SUBMITTED") {
      if (!this.userMatchesAddress(user, existing.terms.approver)) {
        throw new AppError(
          403,
          "FORBIDDEN_APPROVER_ONLY",
          "Only the designated approver can request revisions on submitted work."
        );
      }
      const reason = String(params.reason || "").trim();
      if (!reason) {
        throw new AppError(400, "MISSING_REASON", "Please explain what needs to be revised.");
      }

      return this.repo.update(id, params.expectedVersion, (agr) => {
        if (agr.status !== "FULFILMENT_SUBMITTED") {
          throw new AppError(409, "INVALID_STATE_TRANSITION", "Fulfilment is no longer awaiting review.");
        }
        agr.status = "FUNDED";
        agr.rejectionReason = reason;
        agr.version += 1;
        agr.activity.push(
          this.makeActivity(
            agr.id,
            user.stellarAddress || user.id,
            "APPROVER",
            "REJECTED",
            "Changes requested",
            reason
          )
        );
        return agr;
      });
    }

    // Pre-acceptance / pre-funding term revision
    if (existing.status === "DRAFT" || existing.status === "CREATED") {
      const isPayer = this.userMatchesAddress(user, existing.terms.payer);
      const isRecipient = this.userMatchesAddress(user, existing.terms.recipient);
      if (!isPayer && !isRecipient) {
        throw new AppError(403, "FORBIDDEN_PARTY_ONLY", "Only payer or recipient can propose pre-funding revisions.");
      }

      // Enforce post-acceptance immutability: once either party has accepted, terms cannot be mutated silently;
      // counterparty can request changes (without mutating terms) OR only an unaccepted DRAFT can change terms.
      if ((existing.payerAccepted || existing.recipientAccepted) && params.updatedTerms) {
        throw new AppError(
          409,
          "TERMS_IMMUTABLE_AFTER_ACCEPTANCE",
          "Agreement terms are immutable once a party has accepted. Submit a change note or cancel and create a new agreement."
        );
      }

      const nextTerms: AgreementTerms = params.updatedTerms
        ? {
            ...existing.terms,
            ...params.updatedTerms,
            payer: existing.terms.payer,
            recipient: existing.terms.recipient,
            approver: existing.terms.approver,
            version: existing.terms.version + 1,
          }
        : existing.terms;

      if (params.updatedTerms) {
        validateTerms(nextTerms);
      }

      const nextHash = await computeCanonicalHash(nextTerms);
      const reason = String(params.reason || "").trim() || "Changes requested prior to funding.";

      return this.repo.update(id, params.expectedVersion, (agr) => {
        if (agr.status !== "DRAFT" && agr.status !== "CREATED") {
          throw new AppError(409, "INVALID_STATE_TRANSITION", "Cannot request pre-funding term changes in current status.");
        }
        if (params.updatedTerms) {
          agr.terms = nextTerms;
          agr.title = nextTerms.title;
          agr.description = nextTerms.description;
          agr.canonicalHash = nextHash;
          agr.payerAccepted = false;
          agr.recipientAccepted = false;
        }
        agr.version += 1;
        agr.activity.push(
          this.makeActivity(
            agr.id,
            user.stellarAddress || user.id,
            isPayer ? "PAYER" : "RECIPIENT",
            "CHANGES_REQUESTED",
            "Changes requested",
            reason
          )
        );
        return agr;
      });
    }

    throw new AppError(
      409,
      "TERMS_LOCKED",
      `Changes cannot be requested when agreement is in status "${existing.status}".`
    );
  }

  public async submitFulfilment(
    user: UserRecord,
    id: string,
    params: { notes?: string; evidenceUrl?: string; expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);

    if (!this.userMatchesAddress(user, existing.terms.recipient)) {
      throw new AppError(
        403,
        "FORBIDDEN_RECIPIENT_ONLY",
        "Only the designated recipient can submit fulfilment."
      );
    }

    if (existing.status !== "FUNDED") {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `Fulfilment can only be submitted after the agreement is FUNDED (current status: ${existing.status}).`
      );
    }

    const notes = String(params.notes || "").trim();
    if (!notes) {
      throw new AppError(400, "MISSING_FULFILMENT_NOTES", "Delivery notes or evidence are required.");
    }

    const fulfilmentHash = await computeCanonicalHash({
      agreementId: id,
      notes,
      evidenceUrl: params.evidenceUrl || null,
      submittedBy: user.stellarAddress || user.id,
    });

    return this.repo.update(id, params.expectedVersion, (agr) => {
      if (agr.status !== "FUNDED") {
        throw new AppError(409, "INVALID_STATE_TRANSITION", "Agreement is no longer in FUNDED state.");
      }
      agr.status = "FULFILMENT_SUBMITTED";
      agr.fulfilmentNotes = notes;
      agr.fulfilmentEvidenceUrl = params.evidenceUrl?.trim() || undefined;
      agr.fulfilmentHash = fulfilmentHash;
      agr.rejectionReason = undefined;
      agr.rejectionReasonHash = undefined;
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          "RECIPIENT",
          "FULFILMENT_SUBMITTED",
          "Work submitted for review",
          notes
        )
      );
      return agr;
    });
  }

  public async approveFulfilment(
    user: UserRecord,
    id: string,
    params: { expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);

    if (!this.userMatchesAddress(user, existing.terms.approver)) {
      throw new AppError(
        403,
        "FORBIDDEN_APPROVER_ONLY",
        "Only the designated approver can approve submitted fulfilment."
      );
    }

    if (existing.status !== "FULFILMENT_SUBMITTED") {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `Agreement must be in FULFILMENT_SUBMITTED status to approve (current: ${existing.status}).`
      );
    }

    return this.repo.update(id, params.expectedVersion, (agr) => {
      if (agr.status !== "FULFILMENT_SUBMITTED") {
        throw new AppError(409, "INVALID_STATE_TRANSITION", "Agreement is no longer awaiting approval.");
      }
      agr.status = "APPROVED";
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          "APPROVER",
          "APPROVED",
          "Work approved",
          "Release condition satisfied. Ready for Phase 2 on-chain settlement."
        )
      );
      return agr;
    });
  }

  public async requestCancellation(
    user: UserRecord,
    id: string,
    params: { expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);
    const isPayer = this.userMatchesAddress(user, existing.terms.payer);
    const isRecipient = this.userMatchesAddress(user, existing.terms.recipient);

    if (!isPayer && !isRecipient) {
      throw new AppError(
        403,
        "FORBIDDEN_PARTY_ONLY",
        "Only payer or recipient can request cancellation."
      );
    }

    if (
      existing.status === "DRAFT" ||
      existing.status === "CANCELLED" ||
      existing.status === "RELEASED" ||
      existing.status === "REFUNDED"
    ) {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `Cannot request cancellation in status "${existing.status}".`
      );
    }

    if (existing.cancelRequest !== "NONE") {
      throw new AppError(409, "CANCEL_ALREADY_REQUESTED", "A cancellation request is already active.");
    }

    const requestSide = isPayer ? "REQUESTED_BY_PAYER" : "REQUESTED_BY_RECIPIENT";

    return this.repo.update(id, params.expectedVersion, (agr) => {
      if (agr.cancelRequest !== "NONE") {
        throw new AppError(409, "CANCEL_ALREADY_REQUESTED", "A cancellation request is already active.");
      }
      agr.cancelRequest = requestSide;
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          isPayer ? "PAYER" : "RECIPIENT",
          "CANCEL_REQUESTED",
          "Cancellation requested",
          `${isPayer ? "Client" : "Recipient"} requested mutual cancellation.`
        )
      );
      return agr;
    });
  }

  public async withdrawCancellation(
    user: UserRecord,
    id: string,
    params: { expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);
    const isPayer = this.userMatchesAddress(user, existing.terms.payer);
    const isRecipient = this.userMatchesAddress(user, existing.terms.recipient);

    if (
      (existing.cancelRequest === "REQUESTED_BY_PAYER" && !isPayer) ||
      (existing.cancelRequest === "REQUESTED_BY_RECIPIENT" && !isRecipient) ||
      existing.cancelRequest === "NONE"
    ) {
      throw new AppError(
        403,
        "FORBIDDEN_WITHDRAW_CANCEL",
        "Only the party who initiated the cancellation request can withdraw it."
      );
    }

    return this.repo.update(id, params.expectedVersion, (agr) => {
      agr.cancelRequest = "NONE";
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          isPayer ? "PAYER" : "RECIPIENT",
          "CANCEL_CONFIRMED",
          "Cancellation request withdrawn",
          "Agreement remains active."
        )
      );
      return agr;
    });
  }

  public async confirmCancellation(
    user: UserRecord,
    id: string,
    params: { expectedVersion?: number }
  ): Promise<AgreementRecord> {
    const existing = await this.getForUser(user, id);
    const isPayer = this.userMatchesAddress(user, existing.terms.payer);
    const isRecipient = this.userMatchesAddress(user, existing.terms.recipient);

    const isCounterparty =
      (existing.cancelRequest === "REQUESTED_BY_PAYER" && isRecipient) ||
      (existing.cancelRequest === "REQUESTED_BY_RECIPIENT" && isPayer);

    if (!isCounterparty) {
      throw new AppError(
        403,
        "FORBIDDEN_CONFIRM_CANCEL",
        "Only the counterparty can confirm a pending cancellation request."
      );
    }

    if (
      existing.status === "FUNDED" ||
      existing.status === "FULFILMENT_SUBMITTED" ||
      existing.status === "APPROVED"
    ) {
      throw new AppError(
        501,
        "PHASE_2_REQUIRED",
        "Post-funding mutual cancellation requires an on-chain Trustless Work refund (scheduled for Phase 2)."
      );
    }

    if (existing.status !== "CREATED" && existing.status !== "READY_FOR_FUNDING") {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `Cannot cancel agreement in status "${existing.status}".`
      );
    }

    return this.repo.update(id, params.expectedVersion, (agr) => {
      agr.status = "CANCELLED";
      agr.cancelRequest = "NONE";
      agr.completedAt = new Date().toISOString();
      agr.version += 1;
      agr.activity.push(
        this.makeActivity(
          agr.id,
          user.stellarAddress || user.id,
          isPayer ? "PAYER" : "RECIPIENT",
          "CANCELLED",
          "Agreement cancelled",
          "Mutual cancellation confirmed prior to funding."
        )
      );
      return agr;
    });
  }
}
