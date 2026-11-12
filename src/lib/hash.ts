/**
 * Deterministically sorts object keys lexicographically (RFC 8785 JSON Canonicalization Scheme)
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalizeJson(item)).join(",") + "]";
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs: string[] = [];
  for (const key of sortedKeys) {
    const value = record[key];
    if (value !== undefined) {
      pairs.push(`${JSON.stringify(key)}:${canonicalizeJson(value)}`);
    }
  }

  return "{" + pairs.join(",") + "}";
}

/**
 * Computes canonical SHA-256 digest in hex format (64 chars)
 */
export async function computeCanonicalHash(data: unknown): Promise<string> {
  const canonicalJson = canonicalizeJson(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(canonicalJson);

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle API is not available.");
  }

  const hashBuffer = await subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const computeAgreementHash = computeCanonicalHash;

