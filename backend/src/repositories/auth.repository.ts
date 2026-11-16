import crypto from "crypto";
import path from "path";
import { AppError, OtpRecord, SessionRecord, UserRecord } from "../types/backend.types.js";
import { JsonFileStore } from "./jsonStore.js";

export interface UpsertPrivyUserParams {
  privySub: string;
  stellarAddress: string;
  email: string | null;
  displayName: string | null;
  nowIso: string;
}

export interface UpsertPrivyUserResult {
  user: UserRecord;
  isNewUser: boolean;
}

export interface AuthRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByProviderSubject(provider: UserRecord["provider"], subject: string): Promise<UserRecord | null>;
  findUserByWalletAddress(address: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<UserRecord>;
  upsertPrivyUser(params: UpsertPrivyUserParams): Promise<UpsertPrivyUserResult>;

  saveSession(session: SessionRecord): Promise<SessionRecord>;
  findSession(token: string): Promise<SessionRecord | null>;
  deleteSession(token: string): Promise<void>;

  saveOtp(email: string, record: OtpRecord): Promise<void>;
  findOtp(email: string): Promise<OtpRecord | null>;
  deleteOtp(email: string): Promise<void>;
}

export class FileAuthRepository implements AuthRepository {
  private readonly usersStore: JsonFileStore<Record<string, UserRecord>>;
  private readonly sessionsStore: JsonFileStore<Record<string, SessionRecord>>;
  private readonly otpsStore: JsonFileStore<Record<string, OtpRecord>>;

  constructor(dataDir: string) {
    this.usersStore = new JsonFileStore<Record<string, UserRecord>>(path.join(dataDir, "users.json"));
    this.sessionsStore = new JsonFileStore<Record<string, SessionRecord>>(path.join(dataDir, "sessions.json"));
    this.otpsStore = new JsonFileStore<Record<string, OtpRecord>>(path.join(dataDir, "otps.json"));
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    return users[id] ? structuredClone(users[id]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const users = await this.usersStore.read();
    const found = Object.values(users).find((u) => u.email?.toLowerCase() === normalized);
    return found ? structuredClone(found) : null;
  }

  async findUserByProviderSubject(provider: UserRecord["provider"], subject: string): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    const found = Object.values(users).find(
      (u) => u.provider === provider && u.providerSubject === subject
    );
    return found ? structuredClone(found) : null;
  }

  async findUserByWalletAddress(address: string): Promise<UserRecord | null> {
    const users = await this.usersStore.read();
    const found = Object.values(users).find((u) => u.stellarAddress === address);
    return found ? structuredClone(found) : null;
  }

  async saveUser(user: UserRecord): Promise<UserRecord> {
    return this.usersStore.update((current) => {
      const next = { ...current, [user.id]: structuredClone(user) };
      return { next, result: structuredClone(user) };
    });
  }

  async upsertPrivyUser(params: UpsertPrivyUserParams): Promise<UpsertPrivyUserResult> {
    return this.usersStore.update((current) => {
      const users = Object.values(current);
      const existingBySub = users.find(
        (u) => u.provider === "privy" && u.providerSubject === params.privySub
      );
      const walletOwner = users.find((u) => u.stellarAddress === params.stellarAddress);

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
        user = {
          id: `usr-${crypto.randomUUID()}`,
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
          isSandbox: false,
          createdAt: params.nowIso,
          lastLoginAt: params.nowIso,
        };
      } else {
        if (existingBySub.isSandbox) {
          throw new AppError(
            403,
            "SANDBOX_ACCOUNT_CONFLICT",
            "Sandbox accounts cannot be bound to a Privy identity."
          );
        }
        if (existingBySub.stellarAddress && existingBySub.stellarAddress !== params.stellarAddress) {
          throw new AppError(
            409,
            "WALLET_IMMUTABLE",
            "Account already has a bound Privy Stellar wallet address."
          );
        }

        isNewUser = false;
        const existing = structuredClone(existingBySub);
        user = {
          ...existing,
          email: params.email ?? existing.email,
          displayName: params.displayName || existing.displayName,
          stellarAddress: existing.stellarAddress || params.stellarAddress,
          walletCustody: "privy_embedded",
          lastLoginAt: params.nowIso,
        };
      }

      const next = { ...current, [user.id]: structuredClone(user) };
      return { next, result: { user: structuredClone(user), isNewUser } };
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
