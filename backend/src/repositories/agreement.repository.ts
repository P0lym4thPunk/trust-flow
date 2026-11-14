import path from "path";
import { AgreementRecord, AppError } from "../types/backend.types.js";
import { JsonFileStore } from "./jsonStore.js";

export interface AgreementRepository {
  findAll(): Promise<AgreementRecord[]>;
  findById(id: string): Promise<AgreementRecord | null>;
  create(record: AgreementRecord): Promise<AgreementRecord>;
  update(
    id: string,
    expectedVersion: number | undefined,
    mutator: (current: AgreementRecord) => AgreementRecord
  ): Promise<AgreementRecord>;
  delete(id: string): Promise<boolean>;
}

export class FileAgreementRepository implements AgreementRepository {
  private readonly store: JsonFileStore<Record<string, AgreementRecord>>;

  constructor(dataDir: string, fileName = "agreements.json") {
    this.store = new JsonFileStore<Record<string, AgreementRecord>>(path.join(dataDir, fileName));
  }

  async findAll(): Promise<AgreementRecord[]> {
    const map = await this.store.read();
    return Object.values(map).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async findById(id: string): Promise<AgreementRecord | null> {
    const map = await this.store.read();
    return map[id] ? structuredClone(map[id]) : null;
  }

  async create(record: AgreementRecord): Promise<AgreementRecord> {
    return this.store.update((current) => {
      if (current[record.id]) {
        throw new AppError(409, "AGREEMENT_EXISTS", "An agreement with this ID already exists.");
      }
      const next = { ...current, [record.id]: structuredClone(record) };
      return { next, result: structuredClone(record) };
    });
  }

  async update(
    id: string,
    expectedVersion: number | undefined,
    mutator: (current: AgreementRecord) => AgreementRecord
  ): Promise<AgreementRecord> {
    return this.store.update((current) => {
      const existing = current[id];
      if (!existing) {
        throw new AppError(404, "AGREEMENT_NOT_FOUND", "Agreement not found.");
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new AppError(
          409,
          "VERSION_CONFLICT",
          `Agreement version conflict: expected ${expectedVersion}, actual ${existing.version}. Reload the latest state and retry.`
        );
      }

      const updated = mutator(structuredClone(existing));
      updated.updatedAt = new Date().toISOString();
      const next = { ...current, [id]: structuredClone(updated) };
      return { next, result: structuredClone(updated) };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.store.update((current) => {
      if (!current[id]) {
        return { next: current, result: false };
      }
      const next = { ...current };
      delete next[id];
      return { next, result: true };
    });
  }
}
