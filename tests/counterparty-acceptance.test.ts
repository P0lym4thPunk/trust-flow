import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { computeCanonicalHash, canonicalizeJson } from "../src/lib/hash";
import { createBackendApp } from "../backend/src/index";
import { SANDBOX_PERSONAS } from "../backend/src/services/auth.service";

const ALICE_ADDR = SANDBOX_PERSONAS.alice.stellarAddress;
const BOB_ADDR = SANDBOX_PERSONAS.bob.stellarAddress;

async function startTestServer(tempDir: string) {
  const backend = createBackendApp({
    dataDir: tempDir,
    allowDevSandbox: true,
  });
  const server = http.createServer(backend.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    backend,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function loginSandbox(baseUrl: string, persona: "alice" | "bob" | "charlie"): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe("TrustFlow Canonical Hash & Isolated Counter-Party Acceptance Suite", () => {
  const sampleTerms1 = {
    amount: "500.00",
    asset: "USDC" as const,
    payer: ALICE_ADDR,
    recipient: BOB_ADDR,
    approver: ALICE_ADDR,
    title: "Website Redesign & Brand Assets",
    description: "Design responsive components and export Figma tokens",
    deliverables: ["Figma source", "React component kit"],
    condition: "Payer approves submitted Figma design and code",
    cancellationTerms: "Mutual cancellation permitted prior to review",
    deadline: "2026-11-20T00:00:00.000Z",
    contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
    domain: "trustflow.stellar.escrow.v1",
    network: "testnet" as const,
    version: 1,
  };

  const sampleTermsJumbled = {
    version: 1,
    title: "Website Redesign & Brand Assets",
    recipient: BOB_ADDR,
    network: "testnet" as const,
    payer: ALICE_ADDR,
    domain: "trustflow.stellar.escrow.v1",
    deliverables: ["Figma source", "React component kit"],
    description: "Design responsive components and export Figma tokens",
    deadline: "2026-11-20T00:00:00.000Z",
    contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
    condition: "Payer approves submitted Figma design and code",
    cancellationTerms: "Mutual cancellation permitted prior to review",
    asset: "USDC" as const,
    approver: ALICE_ADDR,
    amount: "500.00",
  };

  describe("Deterministic Canonical Hash Verification", () => {
    it("sorts keys lexicographically and produces identical canonical JSON", () => {
      const canonical1 = canonicalizeJson(sampleTerms1);
      const canonical2 = canonicalizeJson(sampleTermsJumbled);

      assert.strictEqual(canonical1, canonical2);
      assert.strictEqual(canonical1.startsWith('{"amount":"500.00"'), true);
    });

    it("computes identical SHA-256 hash regardless of object key order", async () => {
      const hash1 = await computeCanonicalHash(sampleTerms1);
      const hash2 = await computeCanonicalHash(sampleTermsJumbled);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(hash1));
    });

    it("produces a distinct hash when any term is modified", async () => {
      const hashOriginal = await computeCanonicalHash(sampleTerms1);
      const hashTampered = await computeCanonicalHash({
        ...sampleTerms1,
        amount: "500.01",
      });

      assert.notStrictEqual(hashOriginal, hashTampered);
    });
  });

  describe("Counter-Party Acceptance Flow via Isolated HTTP API", () => {
    let tempDir: string;
    let baseUrl: string;
    let closeServer: () => Promise<void>;
    let aliceToken: string;
    let bobToken: string;
    let agreementId: string;
    let canonicalHash: string;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-accept-test-"));
      const srv = await startTestServer(tempDir);
      baseUrl = srv.baseUrl;
      closeServer = srv.close;

      aliceToken = await loginSandbox(baseUrl, "alice");
      bobToken = await loginSandbox(baseUrl, "bob");

      const createRes = await fetch(`${baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          transactionType: "WORK",
          terms: sampleTerms1,
        }),
      });
      assert.strictEqual(createRes.status, 201);
      const created = (await createRes.json()) as any;
      agreementId = created.id;
      canonicalHash = created.canonicalHash;
    });

    afterEach(async () => {
      await closeServer();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("records recipient acceptance when authenticated as recipient and canonical hash matches", async () => {
      const acceptRes = await fetch(`${baseUrl}/api/agreements/${agreementId}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          role: "RECIPIENT",
          canonicalHash,
          expectedVersion: 1,
        }),
      });

      assert.strictEqual(acceptRes.status, 200);
      const body = (await acceptRes.json()) as any;
      assert.strictEqual(body.recipientAccepted, true);
      assert.strictEqual(body.payerAccepted, true);
      assert.strictEqual(body.status, "READY_FOR_FUNDING");
      assert.strictEqual(body.version, 2);

      const latestActivity = body.activity[body.activity.length - 1];
      assert.strictEqual(latestActivity.type, "ACCEPTED");
      assert.strictEqual(latestActivity.actorRole, "RECIPIENT");
    });

    it("rejects acceptance if canonical hash does not match (tampering protection)", async () => {
      const acceptRes = await fetch(`${baseUrl}/api/agreements/${agreementId}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          role: "RECIPIENT",
          canonicalHash: "f".repeat(64),
          expectedVersion: 1,
        }),
      });

      assert.strictEqual(acceptRes.status, 400);
      const errBody = (await acceptRes.json()) as any;
      assert.ok(String(errBody.error).includes("Canonical hash mismatch"));

      const getRes = await fetch(`${baseUrl}/api/agreements/${agreementId}`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      });
      const latest = (await getRes.json()) as any;
      assert.strictEqual(latest.recipientAccepted, false);
      assert.strictEqual(latest.status, "CREATED");
    });

    it("rejects acceptance for an invalid role", async () => {
      const acceptRes = await fetch(`${baseUrl}/api/agreements/${agreementId}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          role: "SPECTATOR",
          canonicalHash,
        }),
      });

      assert.strictEqual(acceptRes.status, 400);
      const errBody = (await acceptRes.json()) as any;
      assert.ok(String(errBody.error).includes("Invalid role"));
    });
  });
});
