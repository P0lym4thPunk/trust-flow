import { AgreementRecord } from "../types/agreement";

export type VisualStatusTone = "neutral" | "amber" | "purple" | "emerald" | "rose";

export interface AgreementVisualStatus {
  key: string;
  label: string;
  summary: string;
  tone: VisualStatusTone;
  isSimulatedTx: boolean;
  isDeadlinePassed: boolean;
}

export function isSimulatedHash(hash?: string): boolean {
  if (!hash) return false;
  return (
    hash.startsWith("tf-tx-") ||
    hash.startsWith("tf-rel-") ||
    hash.startsWith("tf-ref-") ||
    hash.startsWith("sub-")
  );
}

export function getAgreementVisualStatus(agreement: AgreementRecord): AgreementVisualStatus {
  const deadlineMs = agreement.terms?.deadline ? Date.parse(agreement.terms.deadline) : NaN;
  const isDeadlinePassed =
    !Number.isNaN(deadlineMs) &&
    deadlineMs < Date.now() &&
    agreement.status !== "RELEASED" &&
    agreement.status !== "REFUNDED" &&
    agreement.status !== "CANCELLED";

  const isSimulatedTx =
    isSimulatedHash(agreement.fundingTxHash) ||
    isSimulatedHash(agreement.releaseTxHash) ||
    isSimulatedHash(agreement.refundTxHash);

  if (agreement.status === "CANCELLED") {
    return {
      key: "cancelled",
      label: "Cancelled",
      summary: "This agreement was cancelled before completion.",
      tone: "neutral",
      isSimulatedTx,
      isDeadlinePassed: false,
    };
  }

  if (agreement.status === "REFUNDED") {
    return {
      key: "refunded",
      label: "Refunded",
      summary: "Funds were returned to the client.",
      tone: "neutral",
      isSimulatedTx,
      isDeadlinePassed: false,
    };
  }

  if (agreement.cancelRequest && agreement.cancelRequest !== "NONE") {
    const initiator =
      agreement.cancelRequest === "REQUESTED_BY_PAYER" ? "client" : "freelancer";
    return {
      key: "dispute_cancel",
      label: "Cancellation requested",
      summary: `The ${initiator} requested cancellation. Funds stay held until both sides confirm or resolve.`,
      tone: "rose",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  if (agreement.status === "RELEASED") {
    return {
      key: "released",
      label: "Payment released",
      summary: isSimulatedTx
        ? "Recorded as released in test workspace simulation."
        : "Payment has been released to the recipient.",
      tone: "emerald",
      isSimulatedTx,
      isDeadlinePassed: false,
    };
  }

  if (agreement.status === "APPROVED") {
    return {
      key: "approved",
      label: "Approved · Release pending",
      summary: "Work has been approved and is ready for final payment release.",
      tone: "emerald",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  if (agreement.status === "FULFILMENT_SUBMITTED") {
    return {
      key: "awaiting_review",
      label: "Work submitted · Awaiting review",
      summary: "Deliverables were submitted and are waiting for client review.",
      tone: "purple",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  if (agreement.status === "FUNDED") {
    if (agreement.rejectionReason) {
      return {
        key: "work_rejected",
        label: "Changes requested",
        summary: "Client requested revisions to submitted work. Funds remain secured.",
        tone: "rose",
        isSimulatedTx,
        isDeadlinePassed,
      };
    }

    return {
      key: "funded",
      label: "Funds secured · Work in progress",
      summary: isSimulatedTx
        ? "Marked as funded in test workspace simulation."
        : "Payment is secured while work is underway.",
      tone: "purple",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  if (agreement.status === "DRAFT") {
    return {
      key: "draft",
      label: "Draft",
      summary: "Agreement terms are still being prepared.",
      tone: "neutral",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  // CREATED or READY_FOR_FUNDING
  if (
    agreement.status === "READY_FOR_FUNDING" ||
    (agreement.payerAccepted && agreement.recipientAccepted)
  ) {
    return {
      key: "awaiting_funding",
      label: "Accepted · Awaiting funding",
      summary: "Both parties accepted the terms. On-chain funding is scheduled for Phase 2.",
      tone: "amber",
      isSimulatedTx,
      isDeadlinePassed,
    };
  }

  return {
    key: "awaiting_acceptance",
    label: "Awaiting acceptance",
    summary: "Waiting for both parties to review and agree to the terms.",
    tone: "amber",
    isSimulatedTx,
    isDeadlinePassed,
  };
}

export function getToneClasses(tone: VisualStatusTone): {
  text: string;
  bg: string;
  border: string;
} {
  switch (tone) {
    case "emerald":
      return {
        text: "text-emerald-700 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/25",
      };
    case "purple":
      return {
        text: "text-[#4A2574] dark:text-[#F5D03A]",
        bg: "bg-[#4A2574]/8 dark:bg-[#F5D03A]/10",
        border: "border-[#4A2574]/20 dark:border-[#F5D03A]/25",
      };
    case "amber":
      return {
        text: "text-amber-700 dark:text-amber-300",
        bg: "bg-amber-500/10",
        border: "border-amber-500/25",
      };
    case "rose":
      return {
        text: "text-rose-700 dark:text-rose-300",
        bg: "bg-rose-500/10",
        border: "border-rose-500/25",
      };
    default:
      return {
        text: "text-[var(--tf-muted)]",
        bg: "bg-[var(--tf-surface-subtle)]",
        border: "border-[var(--tf-border)]",
      };
  }
}
