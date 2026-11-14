import { JwtVerifierService } from "../services/jwtVerifier.service.js";

/**
 * Pollar / Privy Authentication & Embedded Wallet Adapter (Server Verification Boundary)
 *
 * Never trusts unverified tokens or falls back to fake authenticated demo users.
 */
export interface PollarSessionVerification {
  valid: boolean;
  userId?: string;
  stellarAddress?: string;
  error?: string;
}

export class PollarAdapter {
  private readonly appId: string | null =
    process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || process.env.POLLAR_APP_ID || null;
  private readonly verificationKeyPem: string | null = process.env.PRIVY_VERIFICATION_KEY || null;
  private readonly verifier = new JwtVerifierService();

  async verifySession(token: string): Promise<PollarSessionVerification> {
    if (!token) {
      return { valid: false, error: "Missing authorization token" };
    }
    if (!this.appId) {
      return { valid: false, error: "Privy/Pollar credentials are not configured on this server" };
    }

    try {
      const verified = await this.verifier.verifyPrivyAccessToken(token, {
        appId: this.appId,
        verificationKeyPem: this.verificationKeyPem,
      });
      return {
        valid: true,
        userId: verified.sub,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || "Privy token verification failed",
      };
    }
  }

  isConfigured(): boolean {
    return Boolean(this.appId);
  }
}

export const pollarAdapter = new PollarAdapter();
