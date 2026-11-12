import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalHash, canonicalizeJson } from "../src/lib/hash";
import { agreementService } from "../backend/src/services/agreement.service";
import { handleAcceptAgreement } from "../backend/src/controllers/agreement.controller";
import { AgreementRecord } from "../src/types/agreement";

const expect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  not: {
    toBe: (expected: any) => assert.notStrictEqual(actual, expected),
    toBeNull: () => assert.notStrictEqual(actual, null),
  },
  toHaveLength: (len: number) => assert.strictEqual(actual?.length, len),
  toContain: (substr: string) => assert.ok(String(actual).includes(substr)),
});


describe("TrustFlow Canonical Hash & Counter-Party Acceptance Suite", () => {
  const sampleTerms1 = {
    amount: "500.00",
    asset: "USDC" as const,
    payer: "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
    recipient: "GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K",
    approver: "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
    title: "Website Redesign & Brand Assets",
    description: "Design responsive components and export Figma tokens",
    deliverables: ["Figma source", "React component kit"],
    condition: "Payer approves submitted Figma design and code",
    cancellationTerms: "Mutual cancellation permitted prior to review",
    deadline: "2026-11-20T00:00:00.000Z",
    contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    domain: "trustflow.stellar.escrow.v1",
    network: "testnet" as const,
    version: 1,
  };

  // Same terms, but keys defined in completely reversed/jumbled order
  const sampleTermsJumbled = {
    version: 1,
    title: "Website Redesign & Brand Assets",
    recipient: "GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K",
    network: "testnet" as const,
    payer: "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
    domain: "trustflow.stellar.escrow.v1",
    deliverables: ["Figma source", "React component kit"],
    description: "Design responsive components and export Figma tokens",
    deadline: "2026-11-20T00:00:00.000Z",
    contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    condition: "Payer approves submitted Figma design and code",
    cancellationTerms: "Mutual cancellation permitted prior to review",
    asset: "USDC" as const,
    approver: "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
    amount: "500.00",
  };

  describe("Deterministic Canonical Hash Verification", () => {
    it("sorts keys lexicographically and produces identical canonical JSON", () => {
      const canonical1 = canonicalizeJson(sampleTerms1);
      const canonical2 = canonicalizeJson(sampleTermsJumbled);

      expect(canonical1).toBe(canonical2);
      expect(canonical1.startsWith('{"amount":"500.00"')).toBe(true);
    });

    it("computes identical SHA-256 hash regardless of object key order", async () => {
      const hash1 = await computeCanonicalHash(sampleTerms1);
      const hash2 = await computeCanonicalHash(sampleTermsJumbled);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
    });

    it("produces a distinct hash when any term is modified", async () => {
      const hashOriginal = await computeCanonicalHash(sampleTerms1);
      
      const tamperedTerms = {
        ...sampleTerms1,
        amount: "500.01", // Slight modification
      };
      const hashTampered = await computeCanonicalHash(tamperedTerms);

      expect(hashOriginal).not.toBe(hashTampered);
    });
  });

  describe("Counter-Party Acceptance Flow via Backend Controller", () => {
    const testAgreementId = `agr-test-${Date.now()}`;
    let canonicalHash: string;

    beforeEach(async () => {
      canonicalHash = await computeCanonicalHash(sampleTerms1);
      const initialAgreement: AgreementRecord = {
        id: testAgreementId,
        transactionType: "WORK",
        title: sampleTerms1.title,
        description: sampleTerms1.description,
        terms: sampleTerms1,
        canonicalHash,
        version: 1,
        status: "CREATED",
        cancelRequest: "NONE",
        payerAccepted: true,
        recipientAccepted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activity: [
          {
            id: `act-1`,
            agreementId: testAgreementId,
            timestamp: new Date().toISOString(),
            actor: sampleTerms1.payer,
            actorRole: "PAYER",
            type: "CREATED",
            title: "Agreement Created & Accepted by Payer",
            description: "Initial terms drafted.",
          },
        ],
      };

      agreementService.save(initialAgreement as any);
    });

    it("successfully records recipient acceptance when canonical hash matches", async () => {
      let responseStatus = 200;
      let responseBody: any = null;

      const mockReq: any = {
        params: { id: testAgreementId },
        body: {
          role: "RECIPIENT",
          actor: sampleTerms1.recipient,
          canonicalHash: canonicalHash,
        },
      };

      const mockRes: any = {
        status: (code: number) => {
          responseStatus = code;
          return mockRes;
        },
        json: (data: any) => {
          responseBody = data;
          return mockRes;
        },
      };

      await handleAcceptAgreement(mockReq, mockRes);

      expect(responseStatus).toBe(200);
      expect(responseBody).not.toBeNull();
      expect(responseBody.recipientAccepted).toBe(true);
      expect(responseBody.payerAccepted).toBe(true);
      // Both parties have accepted -> status must transition to READY_FOR_FUNDING
      expect(responseBody.status).toBe("READY_FOR_FUNDING");

      // Verify activity log includes ACCEPTED event
      const latestActivity = responseBody.activity[responseBody.activity.length - 1];
      expect(latestActivity.type).toBe("ACCEPTED");
      expect(latestActivity.actorRole).toBe("RECIPIENT");
    });

    it("rejects acceptance if canonical hash does not match (tampering protection)", async () => {
      let responseStatus = 200;
      let responseBody: any = null;

      const mockReq: any = {
        params: { id: testAgreementId },
        body: {
          role: "RECIPIENT",
          actor: sampleTerms1.recipient,
          canonicalHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", // Fake/tampered hash
        },
      };

      const mockRes: any = {
        status: (code: number) => {
          responseStatus = code;
          return mockRes;
        },
        json: (data: any) => {
          responseBody = data;
          return mockRes;
        },
      };

      await handleAcceptAgreement(mockReq, mockRes);

      expect(responseStatus).toBe(400);
      expect(responseBody.error).toContain("Canonical hash mismatch");

      // Verify database record was NOT updated
      const agreement = agreementService.getById(testAgreementId);
      expect(agreement?.recipientAccepted).toBe(false);
      expect(agreement?.status).toBe("CREATED");
    });

    it("rejects acceptance for an invalid role", async () => {
      let responseStatus = 200;
      let responseBody: any = null;

      const mockReq: any = {
        params: { id: testAgreementId },
        body: {
          role: "SPECTATOR",
          actor: "G_UNKNOWN",
          canonicalHash,
        },
      };

      const mockRes: any = {
        status: (code: number) => {
          responseStatus = code;
          return mockRes;
        },
        json: (data: any) => {
          responseBody = data;
          return mockRes;
        },
      };

      await handleAcceptAgreement(mockReq, mockRes);

      expect(responseStatus).toBe(400);
      expect(responseBody.error).toContain("Invalid role");
    });
  });
});
