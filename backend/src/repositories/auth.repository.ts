import path from "path";
import { OtpRecord, SessionRecord, UserRecord } from "../types/backend.types.js";
import { JsonFileStore } from "./jsonStore.js";

export interface AuthRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByProviderSubject(provider: UserRecord["provider"], subject: string): Promise<UserRecord | null>;
  findUserByWalletAddress(address: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<UserRecord>;

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
