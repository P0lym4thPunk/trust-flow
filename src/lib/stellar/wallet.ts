import { validateStellarAddress } from "./config";

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
  provider?: "google" | "email_otp" | "privy" | "freighter" | "simulated";
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
  walletName: string; // e.g. "Freighter" | "Albedo" | "Simulated Persona"
}

export const DEFAULT_WALLET_STATE: WalletState = {
  isConnected: true,
  isSimulated: true,
  currentAccount: SIMULATED_PROFILES[0],
  walletName: "Simulated Persona",
};

/**
 * Connect to authentic Freighter wallet if installed in browser
 */
export async function connectFreighterWallet(): Promise<WalletAccount | null> {
  const freighter = (window as any)?.freighterApi;
  if (!freighter) {
    throw new Error(
      "Freighter wallet extension was not detected. Please install Freighter from https://www.freighter.app or use Simulated Persona Mode."
    );
  }

  const isConnected = await freighter.isConnected();
  if (!isConnected) {
    await freighter.requestAccess();
  }

  const publicKey = await freighter.getPublicKey();
  if (!publicKey || !validateStellarAddress(publicKey)) {
    throw new Error("Failed to retrieve valid Stellar public key from Freighter.");
  }

  return {
    address: publicKey,
    displayName: `Freighter (${publicKey.slice(0, 4)}...${publicKey.slice(-4)})`,
    role: "PAYER",
    avatar: "🚀",
    balanceXLM: "Querying...",
    balanceUSDC: "Querying...",
    isSimulated: false,
  };
}
