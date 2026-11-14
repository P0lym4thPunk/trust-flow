import crypto from "crypto";
import { AppError } from "../types/backend.types.js";

export interface JwkKey extends crypto.JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
  kty: string;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  [key: string]: unknown;
}

export type FetchLike = typeof fetch;

interface CachedJwks {
  keys: JwkKey[];
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

function getHashAndDsa(alg: string): { digest: string; isEcdsa: boolean } {
  switch (alg) {
    case "RS256":
      return { digest: "sha256", isEcdsa: false };
    case "RS384":
      return { digest: "sha384", isEcdsa: false };
    case "RS512":
      return { digest: "sha512", isEcdsa: false };
    case "ES256":
      return { digest: "sha256", isEcdsa: true };
    case "ES384":
      return { digest: "sha384", isEcdsa: true };
    default:
      throw new AppError(401, "UNSUPPORTED_JWT_ALG", `Unsupported JWT signing algorithm: ${alg}`);
  }
}

export class JwtVerifierService {
  private readonly jwksCache = new Map<string, CachedJwks>();
  private readonly fetchFn: FetchLike;

  constructor(fetchFn: FetchLike = globalThis.fetch) {
    this.fetchFn = fetchFn;
  }

  private async fetchJwks(jwksUrl: string, forceRefresh = false): Promise<JwkKey[]> {
    const cached = this.jwksCache.get(jwksUrl);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
      return cached.keys;
    }

    let res: Response;
    try {
      res = await this.fetchFn(jwksUrl, { method: "GET" });
    } catch (err: any) {
      throw new AppError(502, "JWKS_FETCH_FAILED", `Unable to fetch signing keys: ${err?.message || "network error"}`);
    }

    if (!res.ok) {
      throw new AppError(502, "JWKS_FETCH_FAILED", `Signing key endpoint returned status ${res.status}`);
    }

    const body = (await res.json()) as { keys?: JwkKey[] };
    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
      throw new AppError(502, "JWKS_INVALID", "Signing key endpoint returned no keys.");
    }

    this.jwksCache.set(jwksUrl, { keys: body.keys, fetchedAt: Date.now() });
    return body.keys;
  }

  public async verifyJwt(
    token: string,
    options: {
      expectedIssuers: string[];
      expectedAudience: string;
      jwksUrl?: string;
      verificationKeyPem?: string;
      clockSkewSeconds?: number;
    }
  ): Promise<JwtClaims> {
    if (!token || typeof token !== "string") {
      throw new AppError(401, "INVALID_TOKEN", "Authorization token is required.");
    }

    const parts = token.trim().split(".");
    if (parts.length !== 3) {
      throw new AppError(401, "INVALID_TOKEN", "Malformed JWT token.");
    }

    const [encodedHeader, encodedPayload, encodedSig] = parts;

    let header: { alg?: string; kid?: string; typ?: string };
    let claims: JwtClaims;
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf-8"));
      claims = JSON.parse(base64UrlDecode(encodedPayload).toString("utf-8"));
    } catch {
      throw new AppError(401, "INVALID_TOKEN", "Unable to parse JWT header or payload.");
    }

    if (!header.alg) {
      throw new AppError(401, "INVALID_TOKEN", "JWT header missing algorithm.");
    }

    const { digest, isEcdsa } = getHashAndDsa(header.alg);
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf-8");
    const signature = base64UrlDecode(encodedSig);

    let verified = false;

    if (options.verificationKeyPem) {
      try {
        const publicKey = crypto.createPublicKey(options.verificationKeyPem);
        verified = crypto.verify(
          digest,
          signingInput,
          isEcdsa ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
          signature
        );
      } catch {
        verified = false;
      }
    } else if (options.jwksUrl) {
      let keys = await this.fetchJwks(options.jwksUrl, false);
      let candidate = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];

      if (!candidate && header.kid) {
        keys = await this.fetchJwks(options.jwksUrl, true);
        candidate = keys.find((k) => k.kid === header.kid);
      }

      if (!candidate) {
        throw new AppError(401, "UNKNOWN_KEY_ID", "No matching signing key found for token.");
      }

      try {
        const publicKey = crypto.createPublicKey({ key: candidate, format: "jwk" });
        verified = crypto.verify(
          digest,
          signingInput,
          isEcdsa ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
          signature
        );
      } catch {
        verified = false;
      }
    } else {
      throw new AppError(503, "VERIFIER_UNCONFIGURED", "No JWT verification key or JWKS URL configured.");
    }

    if (!verified) {
      throw new AppError(401, "INVALID_SIGNATURE", "JWT cryptographic signature verification failed.");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const skew = options.clockSkewSeconds ?? 30;

    if (typeof claims.exp !== "number" || claims.exp + skew < nowSec) {
      throw new AppError(401, "TOKEN_EXPIRED", "Authentication token has expired.");
    }
    if (typeof claims.nbf === "number" && claims.nbf - skew > nowSec) {
      throw new AppError(401, "TOKEN_NOT_ACTIVE", "Authentication token is not valid yet.");
    }

    if (!claims.iss || !options.expectedIssuers.includes(claims.iss)) {
      throw new AppError(401, "INVALID_ISSUER", "Token issuer mismatch.");
    }

    const audMatch = Array.isArray(claims.aud)
      ? claims.aud.includes(options.expectedAudience)
      : claims.aud === options.expectedAudience;
    if (!audMatch) {
      throw new AppError(401, "INVALID_AUDIENCE", "Token audience mismatch.");
    }

    return claims;
  }

  public async verifyGoogleIdToken(idToken: string, clientId: string): Promise<{
    sub: string;
    email: string;
    name?: string;
  }> {
    const claims = await this.verifyJwt(idToken, {
      expectedIssuers: ["accounts.google.com", "https://accounts.google.com"],
      expectedAudience: clientId,
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    });

    const emailVerified = claims.email_verified === true || claims.email_verified === "true";
    if (!emailVerified || typeof claims.email !== "string" || !claims.email.includes("@")) {
      throw new AppError(401, "EMAIL_NOT_VERIFIED", "Google account email is missing or unverified.");
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      throw new AppError(401, "INVALID_SUBJECT", "Google ID token missing subject identifier.");
    }

    return {
      sub: claims.sub,
      email: claims.email.trim().toLowerCase(),
      name: typeof claims.name === "string" ? claims.name : undefined,
    };
  }

  public async verifyPrivyAccessToken(
    accessToken: string,
    config: { appId: string; verificationKeyPem?: string | null }
  ): Promise<{
    sub: string;
    claims: JwtClaims;
  }> {
    const claims = await this.verifyJwt(accessToken, {
      expectedIssuers: ["privy.io"],
      expectedAudience: config.appId,
      verificationKeyPem: config.verificationKeyPem || undefined,
      jwksUrl: config.verificationKeyPem
        ? undefined
        : `https://auth.privy.io/api/v1/apps/${encodeURIComponent(config.appId)}/jwks.json`,
    });

    if (typeof claims.sub !== "string" || !claims.sub) {
      throw new AppError(401, "INVALID_SUBJECT", "Privy token missing subject identifier.");
    }

    return { sub: claims.sub, claims };
  }
}
