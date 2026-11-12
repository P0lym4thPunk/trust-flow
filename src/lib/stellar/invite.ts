import { Keypair } from "@stellar/stellar-sdk";
import { STELLAR_TESTNET_CONFIG } from "./config";

export interface OnChainInvitePayload {
  agreementId: string;
  escrowId?: number;
  contractId: string;
  title: string;
  amount: string;
  asset: string;
  payer: string;
  recipient: string;
  approver: string;
  deadline: string;
  canonicalHash: string;
  version: number;
}

/**
 * Encodes agreement parameters into a compact shareable link / invite payload
 */
export function generateInviteUrl(payload: OnChainInvitePayload): string {
  const serialized = JSON.stringify({
    aid: payload.agreementId,
    eid: payload.escrowId || 1,
    cid: payload.contractId,
    t: payload.title,
    a: payload.amount,
    ast: payload.asset,
    p: payload.payer,
    r: payload.recipient,
    app: payload.approver,
    d: payload.deadline,
    h: payload.canonicalHash,
    v: payload.version,
  });

  const base64 = btoa(encodeURIComponent(serialized));
  const baseUrl = window.location.origin;
  return `${baseUrl}?invite=${base64}`;
}

/**
 * Decodes a shareable invite URL into agreement terms
 */
export function decodeInviteUrl(encodedParam: string): Partial<OnChainInvitePayload> | null {
  try {
    const raw = decodeURIComponent(atob(encodedParam));
    const parsed = JSON.parse(raw);
    return {
      agreementId: parsed.aid,
      escrowId: parsed.eid,
      contractId: parsed.cid,
      title: parsed.t,
      amount: parsed.a,
      asset: parsed.ast,
      payer: parsed.p,
      recipient: parsed.r,
      approver: parsed.app,
      deadline: parsed.d,
      canonicalHash: parsed.h,
      version: parsed.v,
    };
  } catch (err) {
    console.error("Failed to decode invite URL:", err);
    return null;
  }
}

/**
 * Inspects a real Stellar transaction hash via Horizon Testnet API
 */
export async function fetchTestnetTransaction(txHash: string): Promise<any> {
  const url = `${STELLAR_TESTNET_CONFIG.horizonUrl}/transactions/${txHash}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Transaction ${txHash} not found on Stellar Testnet (${response.status})`);
  }
  return response.json();
}
