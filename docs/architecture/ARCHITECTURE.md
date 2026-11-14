# TrustFlow Architecture (Phase 1)

## 1. High-Level System Overview

TrustFlow is a full-stack TypeScript web application built on **Express + Vite (React 19 + Tailwind CSS)** with a single consolidated backend mounted by `server.ts`.

```
Browser (React SPA: src/)
  ├── LandingPage, AuthModal, NavigationShell
  ├── ConversationalWorkspace (6-step creator + Ask TrustFlow AI draft/check)
  ├── AgreementListView & AgreementDetailRoom
  └── AuthContext (Bearer session token + Privy / Freighter / Dev Sandbox bridge)
         │
         ▼ HTTP /api/*
Express Server (server.ts -> mounts backend/src/index.ts)
  ├── /api/auth/*        -> AuthController -> AuthService + AuthRepository + JWKS/JWT Verifiers
  ├── /api/agreements/*  -> AgreementController -> AgreementService + AgreementStateMachine + AgreementRepository
  ├── /api/ai/*          -> AiController -> AiService (GEMINI_MODEL=gemini-3.8-flash + Deterministic Fallback)
  └── /api/escrow/*      -> EscrowController (Phase 2 integration boundary; returns 501 for unverified financial execution)
```

---

## 2. Backend Consolidation

Previously, `server.ts` contained duplicate inline stores and routes while `backend/src/**` existed disconnected from runtime. As of Phase 1:
- `server.ts` is the thin HTTP + Vite/static bootstrapper that instantiates the runtime dependencies (repositories rooted at `DATA_DIR`, auth service, agreement service) and mounts the unified router from `backend/src/index.ts` under `/api`.
- Domain logic, state-machine validation, canonical hashing, authentication, and AI configuration live exclusively inside `backend/src/`.
- Both runtime requests and integration tests invoke the exact same Express app factory (`createApiApp`) and service classes.

---

## 3. Identity, Authentication & Wallet Boundary

TrustFlow strictly separates three distinct concerns:

1. **User Identity (`UserRecord`)**
   - Uniquely identified by `id` and `provider` (`"email_otp" | "google" | "privy" | "dev_sandbox"`).
   - Authenticated by server-issued opaque **CSPRNG session tokens** (`32` random bytes, hex/base64url) stored in `AuthRepository` with expiration (`expiresAt`) and revocation (`POST /api/auth/logout`).
   - Provider credential verification:
     - **Email OTP**: 6-digit random OTP stored as SHA-256 hash (`email + code + server pepper`), 10-minute TTL, max 5 verification attempts per challenge, rate-limited requests per email/IP. Requires a configured mail delivery transport (returns `503 Service Unavailable` when unconfigured — never returns `demoCode` in HTTP responses).
     - **Google OAuth**: Cryptographic RS256 verification of Google ID tokens (`idToken`) against Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`), validating `iss`, `aud === GOOGLE_CLIENT_ID`, `exp`, and `email_verified === true` (returns `503` if `GOOGLE_CLIENT_ID` is unconfigured).
     - **Privy / Pollar**: Cryptographic verification of Privy JWTs (`accessToken`) against Privy JWKS (`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`) or configured `PRIVY_VERIFICATION_KEY` (returns `503` if Privy is unconfigured). User identity `sub` comes from the verified JWT, never an unverified request body.
     - **Development Sandbox (`ALLOW_DEV_SANDBOX`)**: Explicit test-only authentication (`POST /api/auth/sandbox`) allowed **only** when `NODE_ENV !== "production"` and `ALLOW_DEV_SANDBOX !== "false"` (default disabled in production). Issues a real CSPRNG session for one of the three isolated test personas (`Alice`, `Bob`, `Charlie`) marked `isSandbox: true`.

2. **Wallet Identity (`walletAddress`, `walletCustody`)**
   - TrustFlow **never** creates custodial Stellar keypairs on the server or discards secret keys.
   - `walletCustody` can be `"none"`, `"privy_embedded"` (client-managed via Privy + Pollar), `"external_wallet"` (e.g., Freighter browser extension), or `"dev_sandbox"` (non-production persona only).
   - Authenticated users without a linked wallet have `walletAddress: null` until they explicitly link a validated Stellar `G...` address (`POST /api/auth/wallet/link` with StrKey checksum validation and ownership binding).

3. **Agreement Participation (`payer`, `recipient`, `approver`)**
   - Every `/api/agreements*` route requires a valid authenticated session (`401 Unauthorized` otherwise).
   - Agreement queries (`GET /api/agreements`, `GET /api/agreements/:id`) return only agreements where the authenticated caller matches `payer`, `recipient`, or `approver` (by `walletAddress` or `user.id`).
   - Transitions validate both **party membership** and **exact role** (`403 Forbidden` if unauthorized).

---

## 4. Agreement Lifecycle & State Machine (Phase 1)

### Canonical Hash & Term Immutability
- `terms` are canonicalized using RFC 8785 lexicographic JSON key sorting and hashed with SHA-256 (`canonicalHash`).
- `canonicalHash` is always computed and verified server-side on creation and every acceptance.
- Once either party accepts (`payerAccepted` or `recipientAccepted`), `terms` are **immutable** unless both parties are pre-acceptance/pre-funding and an explicit revision resets acceptance and increments `version`.

### Allowed Phase 1 Transitions
| Endpoint | Allowed From | Caller Role | Next State / Effect |
| --- | --- | --- | --- |
| `POST /api/agreements` | *(new)* | `PAYER` or `RECIPIENT` (not self-payment) | `DRAFT` or `CREATED`; server computes `canonicalHash`, initializes `version: 1` |
| `POST /api/agreements/:id/accept` | `CREATED` | `PAYER` or `RECIPIENT` (matching role) | Sets acceptance flag + verifies `canonicalHash`; transitions to `READY_FOR_FUNDING` when both accepted |
| `POST /api/agreements/:id/request-changes` | `DRAFT`, `CREATED` (or `FULFILMENT_SUBMITTED` if funded) | Participant (`PAYER`/`RECIPIENT` pre-funding; `APPROVER` post-funding) | Pre-funding: updates draft terms/increments `version` & resets acceptance (`CREATED`); Post-funding: returns `FULFILMENT_SUBMITTED` → `FUNDED` with `rejectionReason` |
| `POST /api/agreements/:id/fulfil` | `FUNDED` | `RECIPIENT` only | Transitions `FUNDED` → `FULFILMENT_SUBMITTED` |
| `POST /api/agreements/:id/approve` | `FULFILMENT_SUBMITTED` | `APPROVER` only | Transitions `FULFILMENT_SUBMITTED` → `APPROVED` |
| `POST /api/agreements/:id/cancel-request` | Active non-terminal | `PAYER` or `RECIPIENT` | Sets `cancelRequest` (`REQUESTED_BY_PAYER` / `REQUESTED_BY_RECIPIENT`) |
| `POST /api/agreements/:id/cancel-withdraw` | Active with `cancelRequest` | Original requester only | Resets `cancelRequest` → `NONE` |
| `POST /api/agreements/:id/cancel-confirm` | Pre-funding (`DRAFT`, `CREATED`, `READY_FOR_FUNDING`) with `cancelRequest` | Counterparty only | Transitions to `CANCELLED` (post-funding refund requires Phase 2 on-chain execution → `501`) |
| `POST /api/agreements/:id/fund` / `release` / `refund` | Any | Any | **Blocked in Phase 1 (`501 Not Implemented`)** until Trustless Work V1 on-chain verification is integrated in Phase 2 |

Optimistic concurrency is enforced via `expectedVersion` (if provided) and repository write locking, returning `409 Conflict` on stale updates.

---

## 5. Persistence & Test Isolation

- `FileAgreementRepository` and `FileAuthRepository` accept an explicit `dataDir` path (default `process.env.DATA_DIR || path.resolve(process.cwd(), ".data")`).
- All writes go through an in-process per-file promise queue + atomic temp-file write + rename (`fs.writeFileSync` + `fs.renameSync`) to prevent partial writes and race corruption.
- Automated tests instantiate repositories and Express apps against `fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-test-"))` and clean up after execution — guaranteeing `.data/agreements.json` is never polluted by test runs.

---

## 6. AI Assistant Architecture & Privacy Model

- **Development model vs Runtime model**:
  - Development in Google AI Studio Build Mode uses **Gemini 4 Hydrogen** (build environment only; not invoked by application code).
  - TrustFlow application runtime uses **Gemini 3.8 Flash** (`GEMINI_MODEL=gemini-3.8-flash` in centralized server configuration).
- **Server-side only**: `GEMINI_API_KEY` is read strictly on the server and never exposed to Vite (`VITE_*`) or frontend bundles.
- **No silent model substitution**: If `gemini-3.8-flash` is unavailable or `GEMINI_API_KEY` is unset, TrustFlow never substitutes another model silently. It falls back to a deterministic rules engine (`fallbackDraft` / `fallbackCheck`) which returns `CLARIFICATION_REQUIRED` whenever prompt details (amount, deliverable scope) are missing or ambiguous.
- **Controls, Quotas & Privacy**:
  - Free-tier usage is subject to Google AI Studio Gemini API rate and quota limits (not unlimited).
  - Server enforces per-client/user request rate limiting (`AI_RATE_LIMIT_MAX` per window), input character caps (`AI_MAX_INPUT_CHARS`), `maxOutputTokens` caps (`AI_MAX_OUTPUT_TOKENS`), and strict timeouts (`AI_TIMEOUT_MS`).
  - Inputs sent to Gemini are sanitized to strip email addresses, Stellar public keys (`G...`), and extraneous personal identifiers before model invocation. Free-tier API prompts may be subject to Google's free-tier data-use terms, so sensitive PII/financial secrets must never be forwarded.
