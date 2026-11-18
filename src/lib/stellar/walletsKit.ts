import type { ModuleInterface, Networks } from "@creit.tech/stellar-wallets-kit/types";
import { STELLAR_TESTNET_CONFIG, validateStellarAddress } from "./config";

export type StellarWalletProviderId =
  | "varial"
  | "xbull"
  | "lobstr"
  | "hana"
  | "scopuly"
  | "klever"
  | "wallet_connect"
  | "albedo"
  | "rabet";

export interface StellarWalletCapability {
  id: StellarWalletProviderId;
  name: string;
  shortNote: string;
  connect: boolean;
  getAddress: boolean;
  sep53SignMessage: boolean;
  getNetwork: boolean;
  txSignFuture: boolean;
  requiresWalletConnectConfig?: boolean;
  unsupportedReason?: string;
}

export interface StellarWalletProviderStatus extends StellarWalletCapability {
  available: boolean;
  configured: boolean;
  statusLabel: string;
}

export interface StellarWalletAdapter {
  isProviderAvailable(providerId: StellarWalletProviderId): Promise<boolean>;
  connectProvider(providerId: StellarWalletProviderId): Promise<{ address: string }>;
  signMessageWithProvider(
    providerId: StellarWalletProviderId,
    params: { message: string; address: string; networkPassphrase: string }
  ): Promise<{ signature: string; signerAddress?: string }>;
  disconnectProvider?(providerId: StellarWalletProviderId): Promise<void>;
}

export class WalletCapabilityError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletCapabilityError";
    this.code = code;
  }
}

export const STELLAR_WALLET_CATALOG: readonly StellarWalletCapability[] = [
  {
    id: "varial",
    name: "Freighter / Varial",
    shortNote: "Browser extension with full SEP-53 message signing and network lookup.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: true,
    txSignFuture: true,
  },
  {
    id: "xbull",
    name: "xBull Wallet",
    shortNote: "Browser/web Stellar wallet with SEP-53 message signing.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: false,
    txSignFuture: true,
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    shortNote: "Extension wallet; SEP-53 signs with the currently active LOBSTR account.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: false,
    txSignFuture: true,
  },
  {
    id: "hana",
    name: "Hana Wallet",
    shortNote: "Multi-chain browser extension supporting Stellar SEP-53 message signing.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: false,
    txSignFuture: true,
  },
  {
    id: "scopuly",
    name: "Scopuly",
    shortNote: "Stellar extension wallet supporting SEP-53 message signing and network lookup.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: true,
    txSignFuture: true,
  },
  {
    id: "klever",
    name: "Klever Wallet",
    shortNote: "Browser extension supporting Stellar SEP-53 message signing and network lookup.",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: true,
    txSignFuture: true,
  },
  {
    id: "wallet_connect",
    name: "WalletConnect",
    shortNote: "Mobile/desktop QR wallet pairing via Reown (requires VITE_WALLETCONNECT_PROJECT_ID).",
    connect: true,
    getAddress: true,
    sep53SignMessage: true,
    getNetwork: false,
    txSignFuture: true,
    requiresWalletConnectConfig: true,
  },
  {
    id: "albedo",
    name: "Albedo",
    shortNote: "Web signer supporting addresses and transactions only.",
    connect: true,
    getAddress: true,
    sep53SignMessage: false,
    getNetwork: false,
    txSignFuture: true,
    unsupportedReason:
      "Albedo's connector in Stellar Wallets Kit v2.8.0 does not support SEP-53 message signing (returns unsupported error -3), so ownership cannot be verified.",
  },
  {
    id: "rabet",
    name: "Rabet",
    shortNote: "Browser extension supporting addresses and transactions only.",
    connect: true,
    getAddress: true,
    sep53SignMessage: false,
    getNetwork: false,
    txSignFuture: true,
    unsupportedReason:
      "Rabet's connector in Stellar Wallets Kit v2.8.0 does not support SEP-53 message signing (returns unsupported error -3), so ownership cannot be verified.",
  },
] as const;

export function getWalletCapability(providerId: string): StellarWalletCapability | undefined {
  const normalized = providerId === "freighter" ? "varial" : providerId;
  return STELLAR_WALLET_CATALOG.find((entry) => entry.id === normalized);
}

export function formatStellarProviderName(provider: string | null | undefined): string {
  if (!provider) return "External Stellar Wallet";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "privy" || normalized === "privy_embedded") return "Privy Embedded";
  if (normalized === "freighter") return "Freighter";
  if (normalized === "varial") return "Freighter / Varial";
  if (normalized === "xbull") return "xBull";
  if (normalized === "lobstr") return "LOBSTR";
  if (normalized === "hana") return "Hana";
  if (normalized === "scopuly") return "Scopuly";
  if (normalized === "klever") return "Klever";
  if (normalized === "wallet_connect") return "WalletConnect";
  if (normalized === "albedo") return "Albedo";
  if (normalized === "rabet") return "Rabet";
  if (normalized === "dev_sandbox") return "Dev Sandbox";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function getWalletConnectProjectId(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_WALLETCONNECT_PROJECT_ID || "").trim();
}

export function isWalletConnectConfigured(): boolean {
  return getWalletConnectProjectId().length > 0;
}

function normalizeWalletError(providerName: string, err: unknown): Error {
  if (err instanceof WalletCapabilityError) return err;
  const raw =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : err instanceof Error
      ? err.message
      : String(err || "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("cancel") ||
    lower.includes("reject") ||
    lower.includes("declined") ||
    lower.includes("closed") ||
    lower.includes("user denied")
  ) {
    return new Error(`${providerName} request was cancelled. No wallet was linked.`);
  }
  return new Error(raw || `${providerName} operation failed.`);
}

async function createSwkModule(providerId: StellarWalletProviderId): Promise<ModuleInterface> {
  switch (providerId) {
    case "varial": {
      const { VarialModule } = await import("@creit.tech/stellar-wallets-kit/modules/varial");
      return new VarialModule();
    }
    case "xbull": {
      const { xBullModule } = await import("@creit.tech/stellar-wallets-kit/modules/xbull");
      return new xBullModule();
    }
    case "lobstr": {
      const { LobstrModule } = await import("@creit.tech/stellar-wallets-kit/modules/lobstr");
      return new LobstrModule();
    }
    case "hana": {
      const { HanaModule } = await import("@creit.tech/stellar-wallets-kit/modules/hana");
      return new HanaModule();
    }
    case "scopuly": {
      const { ScopulyModule } = await import("@creit.tech/stellar-wallets-kit/modules/scopuly");
      return new ScopulyModule();
    }
    case "klever": {
      const { KleverModule } = await import("@creit.tech/stellar-wallets-kit/modules/klever");
      return new KleverModule();
    }
    case "albedo": {
      const { AlbedoModule } = await import("@creit.tech/stellar-wallets-kit/modules/albedo");
      return new AlbedoModule();
    }
    case "rabet": {
      const { RabetModule } = await import("@creit.tech/stellar-wallets-kit/modules/rabet");
      return new RabetModule();
    }
    case "wallet_connect": {
      const projectId = getWalletConnectProjectId();
      if (!projectId) {
        throw new WalletCapabilityError(
          "WALLETCONNECT_UNCONFIGURED",
          "WalletConnect requires VITE_WALLETCONNECT_PROJECT_ID to be configured."
        );
      }
      const { WalletConnectModule, WalletConnectTargetChain } = await import(
        "@creit.tech/stellar-wallets-kit/modules/wallet-connect"
      );
      const origin = typeof window !== "undefined" ? window.location.origin : "https://trustflow.app";
      return new WalletConnectModule({
        projectId,
        allowedChains: [
          STELLAR_TESTNET_CONFIG.network === "public"
            ? WalletConnectTargetChain.PUBLIC
            : WalletConnectTargetChain.TESTNET,
        ],
        metadata: {
          name: "TrustFlow",
          description: "AI-assisted conditional-payment agreements on Stellar",
          url: origin,
          icons: [],
        },
      });
    }
  }
}

export function createStellarWalletsKitAdapter(): StellarWalletAdapter {
  const moduleCache = new Map<StellarWalletProviderId, ModuleInterface>();

  const getModule = async (providerId: StellarWalletProviderId): Promise<ModuleInterface> => {
    const existing = moduleCache.get(providerId);
    if (existing) return existing;
    const created = await createSwkModule(providerId);
    moduleCache.set(providerId, created);
    return created;
  };

  return {
    async isProviderAvailable(providerId) {
      if (providerId === "wallet_connect" && !isWalletConnectConfigured()) {
        return false;
      }
      try {
        const mod = await getModule(providerId);
        return await Promise.race([
          mod.isAvailable(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 900)),
        ]);
      } catch {
        return false;
      }
    },

    async connectProvider(providerId) {
      const mod = await getModule(providerId);
      const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit/sdk");
      StellarWalletsKit.init({
        network: STELLAR_TESTNET_CONFIG.networkPassphrase as Networks,
        modules: [mod],
      });
      StellarWalletsKit.setWallet(mod.productId);
      const res = await StellarWalletsKit.getAddress();
      return { address: res.address };
    },

    async signMessageWithProvider(providerId, params) {
      const mod = await getModule(providerId);
      const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit/sdk");
      StellarWalletsKit.init({
        network: params.networkPassphrase as Networks,
        modules: [mod],
      });
      StellarWalletsKit.setWallet(mod.productId);
      const res = await StellarWalletsKit.signMessage(params.message, {
        address: params.address,
        networkPassphrase: params.networkPassphrase,
      });
      return {
        signature: res.signedMessage,
        signerAddress: res.signerAddress,
      };
    },

    async disconnectProvider(providerId) {
      const mod = moduleCache.get(providerId);
      if (mod?.disconnect) {
        await mod.disconnect().catch(() => undefined);
      }
    },
  };
}

let defaultAdapterInstance: StellarWalletAdapter | null = null;
function getAdapter(override?: StellarWalletAdapter): StellarWalletAdapter {
  if (override) return override;
  if (!defaultAdapterInstance) {
    defaultAdapterInstance = createStellarWalletsKitAdapter();
  }
  return defaultAdapterInstance;
}

export async function detectAvailableStellarWallets(
  adapter?: StellarWalletAdapter
): Promise<StellarWalletProviderStatus[]> {
  const activeAdapter = getAdapter(adapter);
  const results = await Promise.all(
    STELLAR_WALLET_CATALOG.map(async (capability): Promise<StellarWalletProviderStatus> => {
      const configured =
        capability.requiresWalletConnectConfig ? isWalletConnectConfigured() : true;
      const available =
        capability.sep53SignMessage && configured
          ? await activeAdapter.isProviderAvailable(capability.id).catch(() => false)
          : false;

      let statusLabel = "Not detected";
      if (!capability.sep53SignMessage) {
        statusLabel = "SEP-53 unsupported";
      } else if (!configured) {
        statusLabel = "Needs project ID";
      } else if (available) {
        statusLabel = "Available";
      }

      return {
        ...capability,
        available,
        configured,
        statusLabel,
      };
    })
  );
  return results;
}

export async function connectStellarWalletProvider(
  providerId: StellarWalletProviderId,
  adapter?: StellarWalletAdapter
): Promise<{ providerId: StellarWalletProviderId; providerName: string; address: string }> {
  const capability = getWalletCapability(providerId);
  if (!capability) {
    throw new WalletCapabilityError("UNKNOWN_WALLET_PROVIDER", `Unsupported Stellar wallet provider: ${providerId}`);
  }
  if (!capability.sep53SignMessage) {
    throw new WalletCapabilityError(
      "WALLET_SEP53_UNSUPPORTED",
      capability.unsupportedReason ||
        `${capability.name} does not support SEP-53 message signing required for verified ownership linking.`
    );
  }
  if (capability.requiresWalletConnectConfig && !adapter && !isWalletConnectConfigured()) {
    throw new WalletCapabilityError(
      "WALLETCONNECT_UNCONFIGURED",
      "WalletConnect requires VITE_WALLETCONNECT_PROJECT_ID before connecting."
    );
  }

  const activeAdapter = getAdapter(adapter);
  try {
    const result = await activeAdapter.connectProvider(capability.id);
    if (!result?.address || !validateStellarAddress(result.address)) {
      throw new Error(`Failed to retrieve a valid Stellar public key from ${capability.name}.`);
    }
    return {
      providerId: capability.id,
      providerName: capability.name,
      address: result.address,
    };
  } catch (err) {
    throw normalizeWalletError(capability.name, err);
  }
}

export async function signSep53MessageWithProvider(
  providerId: StellarWalletProviderId,
  params: { address: string; message: string; networkPassphrase?: string },
  adapter?: StellarWalletAdapter
): Promise<{ signature: string; signerAddress?: string }> {
  const capability = getWalletCapability(providerId);
  if (!capability) {
    throw new WalletCapabilityError("UNKNOWN_WALLET_PROVIDER", `Unsupported Stellar wallet provider: ${providerId}`);
  }
  if (!capability.sep53SignMessage) {
    throw new WalletCapabilityError(
      "WALLET_SEP53_UNSUPPORTED",
      capability.unsupportedReason ||
        `${capability.name} does not support SEP-53 message signing required for verified ownership linking.`
    );
  }

  const activeAdapter = getAdapter(adapter);
  try {
    const res = await activeAdapter.signMessageWithProvider(capability.id, {
      address: params.address,
      message: params.message,
      networkPassphrase: params.networkPassphrase || STELLAR_TESTNET_CONFIG.networkPassphrase,
    });

    if (!res?.signature || typeof res.signature !== "string") {
      throw new Error(`${capability.name} did not return a valid SEP-53 signature.`);
    }

    if (res.signerAddress && res.signerAddress !== params.address) {
      throw new Error(
        `${capability.name} signed the ownership challenge using a different Stellar account (${res.signerAddress.slice(0, 6)}...) than selected.`
      );
    }

    return {
      signature: res.signature,
      signerAddress: res.signerAddress,
    };
  } catch (err) {
    throw normalizeWalletError(capability.name, err);
  }
}
