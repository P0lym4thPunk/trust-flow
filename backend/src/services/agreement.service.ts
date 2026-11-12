import fs from "fs";
import path from "path";
import { AgreementRecord, ActivityEvent, AgreementStatus } from "../types/backend.types.js";

const DATA_DIR = path.resolve(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "agreements.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAgreements(): Record<string, AgreementRecord> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to read agreements file:", err);
  }
  return {};
}

function saveAgreements(agreements: Record<string, AgreementRecord>) {
  try {
    const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(agreements, null, 2), "utf-8");
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error("Failed to write agreements file:", err);
  }
}

class AgreementService {
  private store: Record<string, AgreementRecord> = loadAgreements();

  getAll(): AgreementRecord[] {
    return Object.values(this.store).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getById(id: string): AgreementRecord | null {
    return this.store[id] || null;
  }

  save(agreement: AgreementRecord): AgreementRecord {
    agreement.updatedAt = new Date().toISOString();
    this.store[agreement.id] = agreement;
    saveAgreements(this.store);
    return agreement;
  }

  addActivity(id: string, event: Omit<ActivityEvent, "id" | "agreementId" | "timestamp">): AgreementRecord | null {
    const agreement = this.getById(id);
    if (!agreement) return null;

    const fullEvent: ActivityEvent = {
      ...event,
      id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      agreementId: id,
      timestamp: new Date().toISOString(),
    };

    agreement.activity.push(fullEvent);
    return this.save(agreement);
  }

  updateStatus(id: string, newStatus: AgreementStatus, actor: string, actorRole: any, description: string, txHash?: string): AgreementRecord | null {
    const agreement = this.getById(id);
    if (!agreement) return null;

    agreement.status = newStatus;
    return this.addActivity(id, {
      actor,
      actorRole,
      type: "UPDATED",
      title: `Status: ${newStatus}`,
      description,
      txHash,
    });
  }
}

export const agreementService = new AgreementService();
