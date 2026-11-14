import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Serialized, atomic JSON file store parameterized by explicit file path.
 * Ensures concurrent in-process writes cannot race or partially corrupt disk state.
 */
export class JsonFileStore<T extends Record<string, unknown>> {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private readFromDisk(): T {
    if (!fs.existsSync(this.filePath)) {
      return {} as T;
    }
    const raw = fs.readFileSync(this.filePath, "utf-8");
    if (!raw.trim()) {
      return {} as T;
    }
    return JSON.parse(raw) as T;
  }

  private writeToDisk(data: T): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = `${this.filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, this.filePath);
  }

  public async read(): Promise<T> {
    return this.runExclusive(async () => this.readFromDisk());
  }

  public async update<R>(fn: (current: T) => Promise<{ next: T; result: R }> | { next: T; result: R }): Promise<R> {
    return this.runExclusive(async () => {
      const current = this.readFromDisk();
      const { next, result } = await fn(current);
      this.writeToDisk(next);
      return result;
    });
  }

  private runExclusive<R>(task: () => Promise<R>): Promise<R> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
