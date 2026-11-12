/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and Cryptographic Hashing
 * 
 * Provides deterministic canonicalization and SHA-256 digest computation
 * for agreement terms across frontend, backend, and smart contract verification.
 */

/**
 * Deterministically canonicalizes any JSON-compatible value by lexicographically
 * sorting object keys at all nested levels and emitting normalized JSON (RFC 8785).
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalizeJson(item)).join(",") + "]";
  }

  const record = obj as Record<string, unknown>;
  // Deterministically sort keys in lexicographical (Unicode code point) order
  const sortedKeys = Object.keys(record).sort();
  
  const entries: string[] = [];
  for (const key of sortedKeys) {
    const value = record[key];
    // Omit undefined values consistently
    if (value !== undefined) {
      entries.push(`${JSON.stringify(key)}:${canonicalizeJson(value)}`);
    }
  }

  return "{" + entries.join(",") + "}";
}

/**
 * Computes the canonical SHA-256 hex digest (64 characters) of any object or AgreementTerms.
 * Keys are sorted deterministically before hashing to ensure identical outputs regardless
 * of serialization key order.
 */
export async function computeCanonicalHash(data: unknown): Promise<string> {
  const canonicalJson = canonicalizeJson(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(canonicalJson);

  // Use standard Web Crypto API (supported natively in modern browsers, Node.js 18+, and Bun)
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle API is not available in the current environment.");
  }

  const hashBuffer = await subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Backwards-compatible alias for computeCanonicalHash
 */
export const computeAgreementHash = computeCanonicalHash;
