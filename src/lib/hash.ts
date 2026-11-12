import { AgreementTerms } from "../types/agreement";

/**
 * Deterministically sorts object keys lexicographically (RFC 8785 JSON Canonicalization Scheme)
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalizeJson(item)).join(",") + "]";
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`;
  });

  return "{" + pairs.join(",") + "}";
}

/**
 * Computes canonical SHA-256 digest of agreement terms in hex format (64 chars)
 */
export async function computeAgreementHash(terms: AgreementTerms): Promise<string> {
  const canonicalJson = canonicalizeJson({
    amount: terms.amount,
    approver: terms.approver,
    asset: terms.asset,
    cancellationTerms: terms.cancellationTerms,
    condition: terms.condition,
    contractId: terms.contractId,
    deadline: terms.deadline,
    deliverables: terms.deliverables,
    domain: terms.domain,
    network: terms.network,
    payer: terms.payer,
    recipient: terms.recipient,
    title: terms.title,
    version: terms.version,
  });

  // Use standard Web Crypto API (supported in Node.js 18+ and modern browsers)
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalJson);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
