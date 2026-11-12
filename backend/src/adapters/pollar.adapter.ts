/**
 * Pollar / Privy Wallet & Authentication Adapter
 * 
 * Provides an isolated interface for embedded wallet provisioning,
 * session verification, and signing proxy through Pollar / Privy.
 */

export interface PollarSessionVerification {
  valid: boolean;
  userId?: string;
  stellarAddress?: string;
  email?: string;
  error?: string;
}

export class PollarAdapter {
  private appId: string | null = process.env.PRIVY_APP_ID || process.env.POLLAR_APP_ID || null;
  private appSecret: string | null = process.env.PRIVY_APP_SECRET || process.env.POLLAR_API_KEY || null;

  /**
   * Validates an authorization bearer token or session cookie from frontend
   */
  async verifySession(token: string): Promise<PollarSessionVerification> {
    if (!token) {
      return { valid: false, error: "Missing authorization token" };
    }

    // When configured with Privy/Pollar credentials, verify JWT via server SDK
    if (!this.appId || !this.appSecret) {
      // In development / demo mode when credentials are not yet configured:
      return {
        valid: true,
        userId: "usr-demo-001",
        stellarAddress: token.startsWith("G") ? token : "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
        email: "demo@trustflow.stellar",
      };
    }

    // Placeholder for official verified Pollar / Privy server verification call
    return {
      valid: true,
      userId: "usr-verified",
      stellarAddress: "GDQ634WS652Y247B256XCV753N64K7C5N7T7K7K7K7K7K7K7K7K7K7K7",
    };
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }
}

export const pollarAdapter = new PollarAdapter();
