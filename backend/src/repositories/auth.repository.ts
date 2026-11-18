import crypto from "crypto";
import path from "path";
import {
  AppError,
  OtpRecord,
  ProvisioningRecord,
  SessionRecord,
  UserRecord,
  UserWalletRecord,
  WalletChallengeRecord,
} from "../types/backend.types.js";
import { JsonFileStore } from "./jsonStore.js";

export interface UpsertPrivyUserParams {
  privySub: string;
  stellarAddress: string;
  privyWalletId?: string | null;
  email: string | null;
  displayName: string | null;
  nowIso: string;
}

export interface UpsertPrivyUserResult {
  user: UserRecord;
  isNewUser: boolean;
}

export interface ConsumeWalletChallengeParams {
  challengeId: string;
  userId: string;
  address: string;
  nowIso: string;
  verifyFn: (challenge: WalletChallengeRecord) => void;
}

export interface LinkExternalWalletParams {
  userId: string;
  wallet: UserWalletRecord;
  nowIso: string;
}

export interface UnlinkExternalWalletParams {
  userId: string;
  walletId: string;
  nowIso: string;
}

export interface AuthRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByProviderAndEmail(provider: UserRecord["provider"], email: string): Promise<UserRecord | null>;
  findUserByProviderSubject(provider: UserRecord["provider"], subject: string): Promise<UserRecord | null>;
  findUserByWalletAddress(address: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<UserRecord>;
  upsertPrivyUser(params: UpsertPrivyUserParams): Promise<UpsertPrivyUserResult>;
  linkExternalWalletToUser(params: LinkExternalWalletParams): Promise<UserRecord>;
  unlinkExternalWalletFromUser(
    params: UnlinkExternalWalletParams
  ): Promise<{ user: UserRecord; unlinkedWallet: UserWalletRecord }>;

  getProvisioningRecord(privySub: string): Promise<ProvisioningRecord | null>;
  updateProvisioningRecord(
    privySub: string,
    updater: (current: ProvisioningRecord | null) => ProvisioningRecord
  ): Promise<ProvisioningRecord>;

  saveWalletChallenge(challenge: WalletChallengeRecord): Promise<WalletChallengeRecord>;
  findWalletChallenge(challengeId: string): Promise<WalletChallengeRecord | null>;
  consumeWalletChallenge(params: ConsumeWalletChallengeParams): Promise<WalletChallengeRecord>;

  saveSession(session: SessionRecord): Promise<SessionRecord>;
  findSession(token: string): Promise<SessionRecord | null>;
  deleteSession(token: string): Promise<void>;

  saveOtp(email: string, record: OtpRecord): Promise<void>;
  findOtp(email: string): Promise<OtpRecord | null>;
  deleteOtp(email: string): Promise<void>;
}

/**
 * Normalizes legacy scalar UserRecord wallet fields into an additive multi-wallet collection
 * without creating duplicates or altering embedded wallet custody/addresses.
 */
export function normalizeUserWallets(rawUser: UserRecord): UserRecord {
  const user = structuredClone(rawUser);
  const hadExplicitCollection = Array.isArray(user.wallets);
  const wallets: UserWalletRecord[] = hadExplicitCollection ? [...(user.wallets || [])] : [];

  if (!hadExplicitCollection && user.stellarAddress && user.walletCustody !== "none") {
    const timestamp = user.lastLoginAt || user.createdAt || new Date(0).toISOString();
    const custody = user.walletCustody;
    const provider =
      custody === "privy_embedded"
        ? "privy"
        : custody === "dev_sandbox"
        ? "dev_sandbox"
        : "legacy";
    const verificationMethod: UserWalletRecord["verificationMethod"] =
      custody === "privy_embedded"
        ? "privy_embedded"
        : custody === "dev_sandbox"
        ? "dev_sandbox"
        : "legacy_unverified";
    const idPrefix =
      custody === "privy_embedded"
        ? "wal-privy"
        : custody === "dev_sandbox"
        ? "wal-sandbox"
        : "wal-legacy";

    wallets.push({
      id: `${idPrefix}-${user.id}`,
      address: user.stellarAddress,
      custody,
      provider,
      privyWalletId: null,
      verificationMethod,
      verifiedAt: timestamp,
      linkedAt: timestamp,
      unlinkedAt: null,
      status: "active",
      isPrimary: true,
    });
  }

  // Deduplicate active entries with identical address while preserving unlinked audit entries
  const deduped: UserWalletRecord[] = [];
  const seenActiveIndex = new Map<string, number>();

  for (const rawEntry of wallets) {
    const entry: UserWalletRecord = {
      ...rawEntry,
      address: rawEntry.address.trim(),
      status: rawEntry.status === "unlinked" ? "unlinked" : "active",
      unlinkedAt: rawEntry.status === "unlinked" ? rawEntry.unlinkedAt || null : null,
      isPrimary: rawEntry.status === "unlinked" ? false : Boolean(rawEntry.isPrimary),
    };

    if (entry.status === "active") {
      const existingIdx = seenActiveIndex.get(entry.address);
      if (existingIdx !== undefined) {
        const existing = deduped[existingIdx];
        if (!existing.privyWalletId && entry.privyWalletId) {
          existing.privyWalletId = entry.privyWalletId;
        }
        if (entry.custody === "privy_embedded" && existing.custody !== "privy_embedded") {
          deduped[existingIdx] = entry;
        }
        continue;
      }
      seenActiveIndex.set(entry.address, deduped.length);
    }

    deduped.push(entry);
  }

  const activeWallets = deduped.filter((w) => w.status === "active");
  let primaryWallet: UserWalletRecord | undefined =
    activeWallets.find((w) => w.custody === "privy_embedded") ||
    activeWallets.find((w) => w.custody === "dev_sandbox") ||
    activeWallets.find((w) => w.isPrimary) ||
    activeWallets.find((w) => user.primaryWalletAddress && w.address === user.primaryWalletAddress) ||
    activeWallets.find((w) => user.stellarAddress && w.address === user.stellarAddress) ||
    activeWallets[0];

  for (const w of deduped) {
    w.isPrimary = Boolean(primaryWallet && w.id === primaryWallet.id && w.status === "active");
  }

  user.wallets = deduped;
  user.primaryWalletAddress = primaryWallet ? primaryWallet.address : null;
  user.stellarAddress = primaryWallet ? primaryWallet.address : null;
  user.walletCustody = primaryWallet ? primaryWallet.custody : "none";

  return user;
}

export function getActiveUserWalletAddresses(user: UserRecord): string[] {
  const normalized = normalizeUserWallets(user);
  const addresses = (normalized.wallets || [])
    .filter((w) => w.status === "active")
    .map((w) => w.address);
  return Array.from(new Set(addresses));
}

export function getHistoricalUserWalletAddresses(user: UserRecord): string[] {
  const normalized = normalizeUserWallets(user);
  const addresses = (normalized.wallets || []).map((w) => w.address);
  if (normalized.stellarAddress) {
    addresses.push(normalized.stellarAddress);
  }
  return Array.from(new Set(addresses));
}

export class FileAuthRepository implements AuthRepository {
  private readonly usersStore: JsonFileStore<Record<string, UserRecord>>;
  private readonly sessionsStore: JsonFileStore<Record<string, SessionRecord>>;
  private readonly otpsStore: JsonFileStore<Record<string, OtpRecord>>;
  private readonly provisioningStore: JsonFileStore<Record<string, ProvisioningRecord>>;
  private readonly challengesStore: JsonFileStore<Record<string, WalletChallengeRecord>>;

  constructor(dataDir: string) {
    this.usersStore = new JsonFileStore<Record<string, UserRecord>>(path.join(dataDir, "users.json"));
    this.sessionsStore = new JsonFileStore<Record<string, SessionRecord>>(path.join(dataDir, "sessions.json"));
    this.otpsStore = new JsonFileStore<Record<string, OtpRecord>>(path.join(dataDir, "otps.json"));
    this.provisioningStore = new JsonFileStore<Record<string, ProvisioningRecord>>(
      path.join(dataDir, "provisioning.json")
    );
    this.challengesStore = new JsonFileStore<Record<string, WalletChallengeRecord>>(
      path.join(dataDir, "wallet_challenges.json")
    );
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    return users[id] ? normalizeUserWallets(users[id]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const users = await this.usersStore.read();
    const found = Object.values(users).find((u) => u.email?.toLowerCase() === normalized);
    return found ? normalizeUserWallets(found) : null;
  }

  async findUserByProviderAndEmail(
    provider: UserRecord["provider"],
    email: string
  ): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const users = await this.usersStore.read();
    const found = Object.values(users).find(
      (u) => u.provider === provider && !u.isSandbox && u.email?.toLowerCase() === normalized
    );
    return found ? normalizeUserWallets(found) : null;
  }

  async findUserByProviderSubject(
    provider: UserRecord["provider"],
    subject: string
  ): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    const found = Object.values(users).find(
      (u) => u.provider === provider && u.providerSubject === subject
    );
    return found ? normalizeUserWallets(found) : null;
  }

  async findUserByWalletAddress(address: string): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    const found = Object.values(users).find((u) => getActiveUserWalletAddresses(u).includes(address));
    return found ? normalizeUserWallets(found) : null;
  }

  async saveUser(user: UserRecord): Promise<UserRecord> {
    const normalized = normalizeUserWallets(user);
    return this.usersStore.update((current) => {
      const next = { ...current, [normalized.id]: structuredClone(normalized) };
      return { next, result: structuredClone(normalized) };
    });
  }

  async upsertPrivyUser(params: UpsertPrivyUserParams): Promise<UpsertPrivyUserResult> {
    return this.usersStore.update((current) => {
      const users = Object.values(current);
      const existingBySub = users.find(
        (u) => u.provider === "privy" && u.providerSubject === params.privySub
      );
      const walletOwner = users.find((u) =>
        getActiveUserWalletAddresses(u).includes(params.stellarAddress)
      );

      if (walletOwner && walletOwner.id !== existingBySub?.id) {
        throw new AppError(
          409,
          "WALLET_ALREADY_LINKED",
          "This Stellar wallet address is already linked to another user account."
        );
      }

      let user: UserRecord;
      let isNewUser: boolean;

      if (!existingBySub) {
        isNewUser = true;
        const userId = `usr-${crypto.randomUUID()}`;
        const embeddedWalletRecord: UserWalletRecord = {
          id: `wal-privy-${userId}`,
          address: params.stellarAddress,
          custody: "privy_embedded",
          provider: "privy",
          privyWalletId: params.privyWalletId ?? null,
          verificationMethod: "privy_embedded",
          verifiedAt: params.nowIso,
          linkedAt: params.nowIso,
          unlinkedAt: null,
          status: "active",
          isPrimary: true,
        };

        user = normalizeUserWallets({
          id: userId,
          email: params.email,
          displayName:
            params.displayName ||
            (params.email ? params.email.split("@")[0] : "Privy User"),
          avatar: "🚀",
          provider: "privy",
          authVerified: true,
          providerSubject: params.privySub,
          stellarAddress: params.stellarAddress,
          walletCustody: "privy_embedded",
          wallets: [embeddedWalletRecord],
          primaryWalletAddress: params.stellarAddress,
          isSandbox: false,
          createdAt: params.nowIso,
          lastLoginAt: params.nowIso,
        });
      } else {
        if (existingBySub.isSandbox) {
          throw new AppError(
            403,
            "SANDBOX_ACCOUNT_CONFLICT",
            "Sandbox accounts cannot be bound to a Privy identity."
          );
        }

        const normalizedExisting = normalizeUserWallets(existingBySub);
        const existingEmbedded = (normalizedExisting.wallets || []).find(
          (w) => w.status === "active" && w.custody === "privy_embedded"
        );
        const boundAddress = existingEmbedded?.address || normalizedExisting.stellarAddress;

        if (boundAddress && boundAddress !== params.stellarAddress) {
          throw new AppError(
            409,
            "WALLET_IMMUTABLE",
            "Account already has a bound Privy Stellar wallet address."
          );
        }

        isNewUser = false;
        const existingWallets = structuredClone(normalizedExisting.wallets || []);
        const targetAddress = boundAddress || params.stellarAddress;

        if (existingEmbedded) {
          const targetIdx = existingWallets.findIndex((w) => w.id === existingEmbedded.id);
          if (targetIdx !== -1) {
            existingWallets[targetIdx] = {
              ...existingWallets[targetIdx],
              privyWalletId: params.privyWalletId ?? existingWallets[targetIdx].privyWalletId ?? null,
              isPrimary: true,
            };
          }
        } else {
          existingWallets.unshift({
            id: `wal-privy-${normalizedExisting.id}`,
            address: targetAddress,
            custody: "privy_embedded",
            provider: "privy",
            privyWalletId: params.privyWalletId ?? null,
            verificationMethod: "privy_embedded",
            verifiedAt: params.nowIso,
            linkedAt: params.nowIso,
            unlinkedAt: null,
            status: "active",
            isPrimary: true,
          });
        }

        user = normalizeUserWallets({
          ...normalizedExisting,
          email: params.email ?? normalizedExisting.email,
          displayName: params.displayName || normalizedExisting.displayName,
          stellarAddress: targetAddress,
          walletCustody: "privy_embedded",
          wallets: existingWallets,
          primaryWalletAddress: targetAddress,
          lastLoginAt: params.nowIso,
        });
      }

      const next = { ...current, [user.id]: structuredClone(user) };
      return { next, result: { user: structuredClone(user), isNewUser } };
    });
  }

  async linkExternalWalletToUser(params: LinkExternalWalletParams): Promise<UserRecord> {
    return this.usersStore.update((current) => {
      const existingRaw = current[params.userId];
      if (!existingRaw) {
        throw new AppError(404, "USER_NOT_FOUND", "Authenticated user record no longer exists.");
      }
      if (existingRaw.isSandbox) {
        throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
      }

      for (const other of Object.values(current)) {
        if (other.id !== params.userId && getActiveUserWalletAddresses(other).includes(params.wallet.address)) {
          throw new AppError(
            409,
            "WALLET_ALREADY_LINKED",
            "This wallet address is already bound to another account."
          );
        }
      }

      const normalized = normalizeUserWallets(existingRaw);
      const activeAddresses = getActiveUserWalletAddresses(normalized);
      if (activeAddresses.includes(params.wallet.address)) {
        throw new AppError(
          409,
          "WALLET_ALREADY_LINKED",
          "This Stellar wallet address is already linked to your account."
        );
      }

      const wallets = structuredClone(normalized.wallets || []);
      const hasPrimary = wallets.some((w) => w.status === "active" && w.isPrimary);
      const nextWallet: UserWalletRecord = {
        ...structuredClone(params.wallet),
        isPrimary: !hasPrimary,
        status: "active",
        unlinkedAt: null,
      };
      wallets.push(nextWallet);

      const updated = normalizeUserWallets({
        ...normalized,
        wallets,
        lastLoginAt: params.nowIso,
      });

      const next = { ...current, [updated.id]: structuredClone(updated) };
      return { next, result: structuredClone(updated) };
    });
  }

  async unlinkExternalWalletFromUser(
    params: UnlinkExternalWalletParams
  ): Promise<{ user: UserRecord; unlinkedWallet: UserWalletRecord }> {
    return this.usersStore.update((current) => {
      const existingRaw = current[params.userId];
      if (!existingRaw) {
        throw new AppError(404, "USER_NOT_FOUND", "Authenticated user record no longer exists.");
      }
      if (existingRaw.isSandbox) {
        throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
      }

      const normalized = normalizeUserWallets(existingRaw);
      const wallets = structuredClone(normalized.wallets || []);
      const idx = wallets.findIndex((w) => w.id === params.walletId && w.status === "active");
      if (idx === -1) {
        throw new AppError(404, "WALLET_NOT_FOUND", "Active wallet record was not found on this account.");
      }

      const target = wallets[idx];
      if (target.custody === "privy_embedded") {
        throw new AppError(
          403,
          "EMBEDDED_WALLET_IMMUTABLE",
          "Privy embedded Stellar wallets cannot be unlinked or replaced."
        );
      }

      wallets[idx] = {
        ...target,
        status: "unlinked",
        unlinkedAt: params.nowIso,
        isPrimary: false,
      };

      const updated = normalizeUserWallets({
        ...normalized,
        wallets,
      });

      const next = { ...current, [updated.id]: structuredClone(updated) };
      return { next, result: { user: structuredClone(updated), unlinkedWallet: structuredClone(wallets[idx]) } };
    });
  }

  async getProvisioningRecord(privySub: string): Promise<ProvisioningRecord | null> {
    const records = await this.provisioningStore.read();
    return records[privySub] ? structuredClone(records[privySub]) : null;
  }

  async updateProvisioningRecord(
    privySub: string,
    updater: (current: ProvisioningRecord | null) => ProvisioningRecord
  ): Promise<ProvisioningRecord> {
    return this.provisioningStore.update((current) => {
      const existing = current[privySub] ? structuredClone(current[privySub]) : null;
      const updated = structuredClone(updater(existing));
      const next = { ...current, [privySub]: updated };
      return { next, result: structuredClone(updated) };
    });
  }

  async saveWalletChallenge(challenge: WalletChallengeRecord): Promise<WalletChallengeRecord> {
    return this.challengesStore.update((current) => {
      const next = { ...current, [challenge.id]: structuredClone(challenge) };
      return { next, result: structuredClone(challenge) };
    });
  }

  async findWalletChallenge(challengeId: string): Promise<WalletChallengeRecord | null> {
    const challenges = await this.challengesStore.read();
    return challenges[challengeId] ? structuredClone(challenges[challengeId]) : null;
  }

  async consumeWalletChallenge(params: ConsumeWalletChallengeParams): Promise<WalletChallengeRecord> {
    return this.challengesStore.update((current) => {
      const existing = current[params.challengeId];
      if (!existing) {
        throw new AppError(404, "CHALLENGE_NOT_FOUND", "Wallet verification challenge was not found.");
      }

      if (existing.userId !== params.userId) {
        throw new AppError(
          403,
          "CHALLENGE_USER_MISMATCH",
          "This wallet verification challenge belongs to a different user."
        );
      }

      if (existing.address !== params.address) {
        throw new AppError(
          400,
          "CHALLENGE_ADDRESS_MISMATCH",
          "Submitted wallet address does not match the verification challenge."
        );
      }

      if (existing.consumedAt) {
        throw new AppError(
          409,
          "CHALLENGE_ALREADY_USED",
          "This wallet verification challenge has already been used. Request a new challenge."
        );
      }

      if (Date.parse(existing.expiresAt) <= Date.parse(params.nowIso)) {
        throw new AppError(
          401,
          "CHALLENGE_EXPIRED",
          "Wallet verification challenge has expired. Request a new challenge."
        );
      }

      const challenge = structuredClone(existing);
      params.verifyFn(challenge);

      const consumed: WalletChallengeRecord = {
        ...challenge,
        consumedAt: params.nowIso,
      };
      const next = { ...current, [consumed.id]: consumed };
      return { next, result: structuredClone(consumed) };
    });
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord> {
    return this.sessionsStore.update((current) => {
      const next = { ...current, [session.token]: structuredClone(session) };
      return { next, result: structuredClone(session) };
    });
  }

  async findSession(token: string): Promise<SessionRecord | null> {
    const sessions = await this.sessionsStore.read();
    return sessions[token] ? structuredClone(sessions[token]) : null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.sessionsStore.update((current) => {
      if (!current[token]) {
        return { next: current, result: undefined };
      }
      const next = { ...current };
      delete next[token];
      return { next, result: undefined };
    });
  }

  async saveOtp(email: string, record: OtpRecord): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.otpsStore.update((current) => {
      const next = { ...current, [normalized]: structuredClone(record) };
      return { next, result: undefined };
    });
  }

  async findOtp(email: string): Promise<OtpRecord | null> {
    const normalized = email.trim().toLowerCase();
    const otps = await this.otpsStore.read();
    return otps[normalized] ? structuredClone(otps[normalized]) : null;
  }

  async deleteOtp(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.otpsStore.update((current) => {
      if (!current[normalized]) {
        return { next: current, result: undefined };
      }
      const next = { ...current };
      delete next[normalized];
      return { next, result: undefined };
    });
  }
}
