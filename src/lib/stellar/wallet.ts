import { FreighterAdapter } from "@pollar/core";
import { STELLAR_TESTNET_CONFIG, validateStellarAddress } from "./config";

export interface WalletAccount {
  id?: string;
  email?: string;
  address: string;
  displayName: string;
  role: "PAYER" | "RECIPIENT" | "APPROVER";
  avatar: string;
  balanceXLM: string;
  balanceUSDC: string;
  isSimulated: boolean;
  isEmbedded?: boolean;
  provider?: "google" | "email_otp" | "privy" | "freighter" | "simulated" | string;
}

export interface FreighterBridgeLike {
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ address: string }>;
  signStellarMessage(
    message: string,
    options?: { networkPassphrase?: string; accountToSign?: string }
  ): Promise<{ signature: string; signerAddress?: string }>;
}

// 3 Standard Simulated Personas for End-to-End Testing
export const SIMULATED_PROFILES: WalletAccount[] = [
  {
    address: "GC2YDKW52O7MJ62JGPZGQSKWDN6YUHXU3M32QJQ6DFRBATWL6RIHUOP6",
    displayName: "Alice (Client / Payer)",
    role: "PAYER",
    avatar: "👩‍💼",
    balanceXLM: "1,250.00",
    balanceUSDC: "2,500.00",
    isSimulated: true,
  },
  {
    address: "GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX",
    displayName: "Bob (Designer / Recipient)",
    role: "RECIPIENT",
    avatar: "👨‍🎨",
    balanceXLM: "340.50",
    balanceUSDC: "120.00",
    isSimulated: true,
  },
  {
    address: "GCEVSPK3KR7BHVHLBXD2IIVZBP5G4P73WBKWSA6ZWBGHB2FE7JDMZKTL",
    displayName: "Charlie (Approver / Reviewer)",
    role: "APPROVER",
    avatar: "🧑‍⚖️",
    balanceXLM: "500.00",
    balanceUSDC: "0.00",
    isSimulated: true,
  },
];

export interface WalletState {
  isConnected: boolean;
  isSimulated: boolean;
  currentAccount: WalletAccount;
  walletName: string;
}

export const DEFAULT_WALLET_STATE: WalletState = {
  isConnected: true,
  isSimulated: true,
  currentAccount: SIMULATED_PROFILES[0],
  walletName: "Simulated Persona",
};

function resolveFreighterBridge(bridge?: FreighterBridgeLike): FreighterBridgeLike {
  if (bridge) return bridge;
  return new FreighterAdapter();
}

/**
 * Connect to authentic Freighter wallet via @pollar/core FreighterAdapter (@stellar/freighter-api)
 */
export async function connectFreighterWallet(
  bridge?: FreighterBridgeLike
): Promise<WalletAccount> {
  const freighter = resolveFreighterBridge(bridge);
  const available = await freighter.isAvailable().catch(() => false);
  if (!available) {
    throw new Error(
      "Freighter wallet extension was not detected. Please install or unlock Freighter from https://www.freighter.app."
    );
  }

  const { address } = await freighter.connect();
  if (!address || !validateStellarAddress(address)) {
    throw new Error("Failed to retrieve a valid Stellar public key from Freighter.");
  }

  return {
    address,
    displayName: `Freighter (${address.slice(0, 4)}...${address.slice(-4)})`,
    role: "PAYER",
    avatar: "🚀",
    balanceXLM: "Querying...",
    balanceUSDC: "Querying...",
    isSimulated: false,
    provider: "freighter",
  };
}

/**
 * Signs a server-issued SEP-53 challenge message using Freighter's signMessage API.
 */
export async function signFreighterSep53Challenge(params: {
  address: string;
  message: string;
  bridge?: FreighterBridgeLike;
}): Promise<{ signature: string; signerAddress?: string }> {
  const freighter = resolveFreighterBridge(params.bridge);
  const result = await freighter.signStellarMessage(params.message, {
    networkPassphrase: STELLAR_TESTNET_CONFIG.networkPassphrase,
    accountToSign: params.address,
  });

  if (!result?.signature || typeof result.signature !== "string") {
    throw new Error("Freighter did not return a valid SEP-53 signature.");
  }

  if (result.signerAddress && result.signerAddress !== params.address) {
    throw new Error(
      "Freighter signed the challenge with a different Stellar account than selected."
    );
  }

  return {
    signature: result.signature,
    signerAddress: result.signerAddress,
  };
}
