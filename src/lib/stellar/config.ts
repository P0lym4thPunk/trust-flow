import { StrKey } from "@stellar/stellar-sdk";

export const STELLAR_TESTNET_CONFIG = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  domainSeparator: "trustflow.stellar.escrow.v1",
  // Escrow execution engine contract ID placeholder — retired custom contract; Trustless Work provides authoritative on-chain contract ID in Phase 3
  contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
  assets: {
    XLM: {
      code: "XLM",
      name: "Native Stellar Lumens",
      isNative: true,
      decimals: 7,
      sacContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      faucetType: "FRIENDBOT",
      faucetUrl: "https://friendbot.stellar.org",
    },
    USDC: {
      code: "USDC",
      name: "Circle USD Coin (Testnet)",
      isNative: false,
      decimals: 7,
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      sacContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      faucetType: "CIRCLE_FAUCET",
      faucetUrl: "https://faucet.circle.com/",
    },
  },
} as const;

/**
 * Validates Stellar public key with StrKey checksum verification
 */
export function validateStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (!address.startsWith("G") || address.length !== 56) return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Bounds-checked integer stroop conversions (10^7 units)
 */
export const MAX_STROOP_UNITS = 999_999_999_999_999n; // 99,999,999.9999999 units
export const MIN_STROOP_UNITS = 1n;                    // 0.0000001 units

export function toStroopUnits(amountStr: string): bigint {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,7})?$/.test(amountStr)) {
    throw new Error(`Invalid financial amount format: "${amountStr}". Must be positive decimal with up to 7 places.`);
  }
  const [whole, frac = ""] = amountStr.split(".");
  const paddedFrac = frac.padEnd(7, "0");
  const units = BigInt(whole) * 10_000_000n + BigInt(paddedFrac);
  if (units < MIN_STROOP_UNITS || units > MAX_STROOP_UNITS) {
    throw new Error(`Amount units ${units} out of allowed bounds [${MIN_STROOP_UNITS}, ${MAX_STROOP_UNITS}]`);
  }
  return units;
}

export function fromStroopUnits(units: bigint): string {
  if (units < MIN_STROOP_UNITS || units > MAX_STROOP_UNITS) {
    throw new Error(`Amount units ${units} out of allowed bounds [${MIN_STROOP_UNITS}, ${MAX_STROOP_UNITS}]`);
  }
  const whole = units / 10_000_000n;
  const frac = (units % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

export function formatAddress(address: string): string {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
