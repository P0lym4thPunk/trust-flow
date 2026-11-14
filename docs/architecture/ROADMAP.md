# TrustFlow 4-Phase Roadmap

This roadmap defines the strictly phased evolution of TrustFlow from an early-access testnet prototype into a production-ready conditional payment platform on Stellar. Each phase has explicit entry/exit boundaries; work from later phases must not be simulated or faked prematurely.

---

## Phase 1 — Backend Consolidation, Auth Hardening, Authorization & Test Isolation (Current)

**Scope & Deliverables**
- **Single authoritative backend**: Consolidate `server.ts` and `backend/src/**` so Express mounts a single, modular `/api` application (`backend/src/**`) with zero duplicate inline route/store definitions.
- **Persistent repository abstraction & test isolation**: Repository interfaces (`AgreementRepository`, `AuthRepository`) parameterized by `dataDir` with atomic file writes, serialized write locking, and optimistic concurrency (`version` checks returning `409 Conflict`). Automated tests run strictly in temporary directories (`fs.mkdtempSync`) and never touch `.data/agreements.json`.
- **Hardened server-side authentication**:
  - CSPRNG session tokens (`crypto.randomBytes(32)`) with expiry and explicit revocation (`POST /api/auth/logout`).
  - Email OTP with SHA-256 hashed codes, short TTL, verification attempt caps, per-email/IP rate limiting, and **no** `demoCode` HTTP leaks or raw OTP console logging; honest `503` when no email delivery provider is configured.
  - Google OAuth ID token cryptographic verification (RS256 against Google JWKS, `iss`, `aud === GOOGLE_CLIENT_ID`, `exp`, `email_verified`) or honest `503` when unconfigured.
  - Privy JWT cryptographic verification (JWKS / verification key, `iss`, `aud === PRIVY_APP_ID`, `exp`) or honest `503` when unconfigured.
  - Explicit **Development Sandbox** (`POST /api/auth/sandbox`) gated strictly to `NODE_ENV !== "production"` and `ALLOW_DEV_SANDBOX=true`, issuing real session tokens bound to test personas (`Alice`, `Bob`, `Charlie`) for local/CI role testing without weakening production auth.
- **Wallet custody & identity separation**: Remove server-side `Keypair.random()` keyless wallet provisioning. Separate **user identity**, **wallet identity** (Privy embedded wallet, Freighter external wallet, or explicit dev sandbox persona), and **agreement participation**.
- **Strict agreement API authorization & state machine**:
  - Require authentication on all `/api/agreements*` endpoints.
  - Replace open `POST /api/agreements` overwrites with explicit transition endpoints (`/accept`, `/request-changes`, `/fulfil`, `/approve`, `/cancel-request`, `/cancel-withdraw`, `/cancel-confirm`).
  - Enforce participant membership, role-specific permissions, canonical hash verification (RFC 8785), post-acceptance term immutability, self-payment rejection (`payer !== recipient`), and optimistic concurrency.
  - Block direct client `FUNDED`, `RELEASED`, and `REFUNDED` mutations (`403`/`501`) until Phase 2 real escrow execution exists.
- **Centralized AI runtime configuration**: Configure `GEMINI_MODEL` (default `"gemini-3.8-flash"`), `GEMINI_API_KEY` server-side only, rate limits, token limits, timeouts, PII sanitization, and a deterministic fallback that returns `CLARIFICATION_REQUIRED` when amount/scope is unclear (never inventing arbitrary amounts).
- **Frontend reliability**: Check `res.ok` on all mutations, surface backend errors, never show optimistic success before server confirmation, and fix UI validation gaps.

**Out of Scope for Phase 1**
- Real on-chain escrow funding, release, or refund execution (Phase 2).
- Automated 1% fee collection / Treasury contract settlement (Phase 3).
- Independent human dispute arbitration workflows (Phase 3).
- Fiat/NGN off-ramps and mainnet launch hardening (Phase 4).

---

## Phase 2 — Real Escrow Execution Engine (Trustless Work V1 on Stellar Testnet)

**Scope**
- Integrate Trustless Work V1 testnet API / Soroban escrow contracts through `backend/src/adapters/trustlessWork.adapter.ts` and Stellar Horizon/Soroban RPC verification (`stellarRpc.adapter.ts`).
- Client-side transaction signing via Privy embedded Stellar wallets (`@pollar/privy-adapter`) or Freighter (`@stellar/freighter-api`), never holding user private keys on the backend.
- Server-side authoritative transaction verification on Horizon/Soroban RPC before transitioning an agreement to `FUNDED`, `RELEASED`, or `REFUNDED`.
- Real testnet balance queries, trustline readiness checks (USDC), and accurate Explorer links.

---

## Phase 3 — Platform Fee Accounting, Timeouts & Human Dispute Resolution

**Scope**
- Implement and verify the 1% platform fee (borne by the client/funder) at escrow initialization/funding.
- Explicit dispute/arbitration workflow with a mutually accepted human resolver prior to funding (no autonomous AI dispute rulings).
- Deadline expiration guidance and optional agreed timeout/refund rules (never moving funds silently without contract rules and user visibility).

---

## Phase 4 — Production Storage, Mainnet Readiness & Fiat/Anchor Compliance

**Scope**
- Migrate repository implementation from atomic JSON files to managed PostgreSQL/transactional storage while preserving repository interfaces.
- Production email delivery provider, security monitoring, audit logging, and Soroban/Trustless Work mainnet deployment readiness.
- Regulated anchor / withdrawal partners (including NGN off-ramp evaluation where licensed).
