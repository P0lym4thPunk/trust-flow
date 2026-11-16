import { Keypair } from "@stellar/stellar-sdk";
import { extractEmbeddedStellarWallet, type PrivyUserLike } from "./privyLifecycle";

// TEMPORARY PHASE 2.2A STEP 6 DEV-ONLY SIGNING TEST HARNESS
export const EXPECTED_TEST_PRIVY_USER_ID = "did:privy:cmwgp3cne008x0gl4clzivx4z";
export const EXPECTED_TEST_WALLET_ID = "i22g76n84vblvyxw5zdc8cl5";
export const EXPECTED_TEST_STELLAR_ADDRESS =
  "GD7S2BZCLEIS4VDBLW76CWQT56WLL6O3FUI2JOS2AFVJXV6572MKUZXO";
export const EXPECTED_TEST_PUBLIC_KEY_HEX =
  "00ff2d072259112e54615dbfe15a13efacb5f9db2d11a4ba5a016a9bd7ddfe98aa";

export const TEST_HASH_LABEL = "trustflow-phase22a-nonbroadcast-signing-test-v1";
// Deterministic SHA-256 digest of TEST_HASH_LABEL (32 bytes, non-transaction, non-XDR)
export const TEST_HASH_HEX_NO_PREFIX =
  "cf6ccae89fe034a73069bd583d13990a95a4df6942adc9bfe4a76a41330a159b";
export const TEST_HASH_HEX =
  `0x${TEST_HASH_HEX_NO_PREFIX}` as const;

export interface TestSigningEligibilityInput {
  isProd: boolean;
  viteWalletTestMode: boolean;
  controllerTestMode: boolean;
  privyReady: boolean;
  privyAuthenticated: boolean;
  privyUser: PrivyUserLike | null | undefined;
}

export type TestSigningEligibilityResult =
  | {
      eligible: true;
      userId: string;
      walletId: string;
      address: string;
    }
  | {
      eligible: false;
      reason: string;
    };

export interface LocalSignatureVerificationResult {
  signatureValid: boolean;
  verifiedPublicKey: string | null;
  signatureByteLength: number;
  error?: string;
}

export interface NonBroadcastSigningTestResult {
  signingSucceeded: boolean;
  localVerificationPassed: boolean;
  verifiedPublicKey: string | null;
  error: string | null;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Invalid hex encoding.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function getTestHashBytes(): Uint8Array {
  const bytes = hexToBytes(TEST_HASH_HEX);
  if (bytes.length !== 32) {
    throw new Error("Test hash must be exactly 32 bytes.");
  }
  return bytes;
}

export function validateTestSigningEligibility(
  input: TestSigningEligibilityInput
): TestSigningEligibilityResult {
  if (input.isProd) {
    return { eligible: false, reason: "Disabled in production builds." };
  }
  if (!input.viteWalletTestMode || !input.controllerTestMode) {
    return { eligible: false, reason: "VITE_PRIVY_WALLET_TEST_MODE guard is not active." };
  }
  if (!input.privyReady || !input.privyAuthenticated || !input.privyUser) {
    return { eligible: false, reason: "Privy session is not ready and authenticated." };
  }
  if (input.privyUser.id !== EXPECTED_TEST_PRIVY_USER_ID) {
    return { eligible: false, reason: "Authenticated Privy user does not match test identity." };
  }

  const lookup = extractEmbeddedStellarWallet(input.privyUser);
  if (lookup.status !== "found") {
    return { eligible: false, reason: "Expected single embedded Stellar wallet not found." };
  }
  if (lookup.address !== EXPECTED_TEST_STELLAR_ADDRESS) {
    return { eligible: false, reason: "Embedded Stellar address does not match test wallet." };
  }

  const accounts = Array.isArray(input.privyUser.linkedAccounts)
    ? input.privyUser.linkedAccounts
    : [];
  const matchingWallet = accounts.find((raw) => {
    const acc = raw as Record<string, unknown>;
    const chainType = acc.chainType ?? acc.chain_type;
    return (
      acc.type === "wallet" &&
      chainType === "stellar" &&
      typeof acc.address === "string" &&
      acc.address.trim() === EXPECTED_TEST_STELLAR_ADDRESS
    );
  }) as Record<string, unknown> | undefined;

  if (!matchingWallet) {
    return { eligible: false, reason: "Linked Stellar wallet record missing from Privy user." };
  }

  const walletId = typeof matchingWallet.id === "string" ? matchingWallet.id : "";
  if (walletId !== EXPECTED_TEST_WALLET_ID) {
    return { eligible: false, reason: "Stellar wallet ID does not match expected test wallet ID." };
  }

  const walletClientType = matchingWallet.walletClientType ?? matchingWallet.wallet_client_type;
  const recoveryMethod = matchingWallet.recoveryMethod ?? matchingWallet.recovery_method;
  const userCanSign = matchingWallet.userCanSign ?? matchingWallet.user_can_sign;
  const imported = matchingWallet.imported;
  if (
    walletClientType !== "privy" ||
    recoveryMethod !== "privy-v2" ||
    userCanSign === false ||
    imported === true
  ) {
    return { eligible: false, reason: "Wallet metadata is not eligible for unified Privy raw signing." };
  }

  const rawPub = matchingWallet.publicKey ?? matchingWallet.public_key;
  if (typeof rawPub === "string" && rawPub.trim().toLowerCase() !== EXPECTED_TEST_PUBLIC_KEY_HEX) {
    return { eligible: false, reason: "Wallet public key hex does not match expected test key." };
  }

  try {
    const kp = Keypair.fromPublicKey(EXPECTED_TEST_STELLAR_ADDRESS);
    if (`00${bytesToHex(kp.rawPublicKey())}` !== EXPECTED_TEST_PUBLIC_KEY_HEX) {
      return { eligible: false, reason: "Derived Stellar public key hex mismatch." };
    }
  } catch {
    return { eligible: false, reason: "Invalid expected Stellar public key." };
  }

  return {
    eligible: true,
    userId: EXPECTED_TEST_PRIVY_USER_ID,
    walletId,
    address: EXPECTED_TEST_STELLAR_ADDRESS,
  };
}

export function verifyRawHashEd25519Signature(params: {
  signatureHex: string;
  expectedAddress: string;
  hashBytes: Uint8Array;
  expectedPublicKeyHex?: string;
}): LocalSignatureVerificationResult {
  if (!(params.hashBytes instanceof Uint8Array) || params.hashBytes.length !== 32) {
    return {
      signatureValid: false,
      verifiedPublicKey: null,
      signatureByteLength: 0,
      error: "Hash input must be exactly 32 bytes.",
    };
  }

  if (
    typeof params.signatureHex !== "string" ||
    !/^0x[0-9a-fA-F]{128}$/.test(params.signatureHex.trim())
  ) {
    return {
      signatureValid: false,
      verifiedPublicKey: null,
      signatureByteLength: 0,
      error: "Returned signature must be a 0x-prefixed 64-byte hex string.",
    };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(params.signatureHex.trim());
  } catch {
    return {
      signatureValid: false,
      verifiedPublicKey: null,
      signatureByteLength: 0,
      error: "Failed to decode signature hex bytes.",
    };
  }

  if (sigBytes.length !== 64) {
    return {
      signatureValid: false,
      verifiedPublicKey: null,
      signatureByteLength: sigBytes.length,
      error: "Decoded Ed25519 signature must be exactly 64 bytes.",
    };
  }

  try {
    const keypair = Keypair.fromPublicKey(params.expectedAddress);
    if (params.expectedPublicKeyHex) {
      const derivedHex = `00${bytesToHex(keypair.rawPublicKey())}`;
      if (derivedHex !== params.expectedPublicKeyHex.toLowerCase()) {
        return {
          signatureValid: false,
          verifiedPublicKey: null,
          signatureByteLength: sigBytes.length,
          error: "Stellar public key hex does not match expected wallet public key.",
        };
      }
    }

    const ok = keypair.verify(params.hashBytes, sigBytes);
    const verifiedPublicKey = keypair.publicKey();
    if (!ok || verifiedPublicKey !== params.expectedAddress) {
      return {
        signatureValid: false,
        verifiedPublicKey: null,
        signatureByteLength: sigBytes.length,
        error: "Ed25519 signature failed local cryptographic verification.",
      };
    }

    return {
      signatureValid: true,
      verifiedPublicKey,
      signatureByteLength: sigBytes.length,
    };
  } catch (err) {
    return {
      signatureValid: false,
      verifiedPublicKey: null,
      signatureByteLength: sigBytes.length,
      error: sanitizeSigningError(err),
    };
  }
}

export function sanitizeSigningError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Signing test failed.";
  const cleaned = raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/0x[0-9a-fA-F]{64,}/g, "[redacted-hex]")
    .trim();
  if (!cleaned) {
    return "Signing test failed.";
  }
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

export async function executeNonBroadcastSigningTest(params: {
  eligibilityInput: TestSigningEligibilityInput;
  signRawHash: (input: {
    address: string;
    chainType: "stellar";
    hash: `0x${string}`;
  }) => Promise<{ signature: `0x${string}` }>;
}): Promise<NonBroadcastSigningTestResult> {
  const eligibility = validateTestSigningEligibility(params.eligibilityInput);
  if (!eligibility.eligible) {
    return {
      signingSucceeded: false,
      localVerificationPassed: false,
      verifiedPublicKey: null,
      error: eligibility.reason,
    };
  }

  const hashBytes = getTestHashBytes();

  let signatureHex: `0x${string}`;
  try {
    const result = await params.signRawHash({
      address: eligibility.address,
      chainType: "stellar",
      hash: TEST_HASH_HEX,
    });
    signatureHex = result.signature;
  } catch (err) {
    return {
      signingSucceeded: false,
      localVerificationPassed: false,
      verifiedPublicKey: null,
      error: sanitizeSigningError(err),
    };
  }

  const verification = verifyRawHashEd25519Signature({
    signatureHex,
    expectedAddress: eligibility.address,
    hashBytes,
    expectedPublicKeyHex: EXPECTED_TEST_PUBLIC_KEY_HEX,
  });

  return {
    signingSucceeded: true,
    localVerificationPassed: verification.signatureValid,
    verifiedPublicKey: verification.verifiedPublicKey,
    error: verification.signatureValid ? null : (verification.error ?? "Signature verification failed."),
  };
}
