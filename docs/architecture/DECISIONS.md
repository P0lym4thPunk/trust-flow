# TrustFlow Architecture Decision Records (ADRs)

## ADR-001: Single Authoritative Backend via `server.ts` Mounting `backend/src`
- **Status**: Accepted (Phase 1)
- **Context**: Previously, `server.ts` implemented inline persistence and route handlers while `backend/src/**` held an unmounted copy with diverging status enums (`AWAITING_APPROVAL`, `COMPLETED`, `BY_PAYER` vs frontend `FULFILMENT_SUBMITTED`, `RELEASED`, `REQUESTED_BY_PAYER`).
- **Decision**: Consolidate all domain types, services, controllers, repositories, and routes inside `backend/src/**`, expose a clean `createApiApp(deps)` factory, and have `server.ts` strictly mount `/api` plus Vite/static asset serving. Unify all status and cancellation enums across frontend and backend (`src/types/agreement.ts` and `backend/src/types/backend.types.ts`).
- **Consequences**: Zero split-brain logic; integration tests test the exact HTTP handlers and services used at runtime.

## ADR-002: Explicit Separation of Development Model and Runtime Model
- **Status**: Accepted (Phase 1 — Model Responsibility Correction)
- **Context**: Google AI Studio Build Mode uses Gemini 4 Hydrogen during development, whereas TrustFlow's runtime assistant is specified to use Gemini 3.8 Flash (`gemini-3.8-flash`) with Google AI Studio Gemini API Free Tier initially.
- **Decision**:
  - Centralize runtime model configuration in `backend/src/config/ai.config.ts` with `GEMINI_MODEL` defaulting to `"gemini-3.8-flash"`.
  - Keep `GEMINI_API_KEY` strictly server-side.
  - Never silently substitute an unapproved model if `gemini-3.8-flash` returns an availability/quota error or `GEMINI_API_KEY` is absent; instead invoke the deterministic fallback.
  - Fix `fallbackDraft()` so unclear prompts (e.g. `"test"`, missing amount, missing scope) return `CLARIFICATION_REQUIRED` rather than inventing a `"500.00 USDC"` draft.
  - Sanitize inputs to avoid sending unnecessary PII/wallet addresses to the Gemini Free Tier, enforce configurable rate limits, input/output token bounds, and timeouts, and document free-tier data-use implications.
- **Consequences**: Model ID can be verified against live quotas or swapped via `GEMINI_MODEL` env var without touching application logic.

## ADR-003: Zero Server-Generated Keyless Stellar Wallets
- **Status**: Accepted (Phase 1)
- **Context**: `server.ts:provisionStellarWallet()` previously called `Keypair.random()`, funded it on Friendbot, and immediately discarded the private key — creating permanently unspendable addresses.
- **Decision**: Remove `Keypair.random()` wallet provisioning immediately. Users authenticating via Email OTP or Google obtain a verified **user identity** (`walletAddress: null`, `walletCustody: "none"`) until they link a client-managed Privy/Pollar embedded wallet or an external wallet (Freighter). Development testing uses explicit Dev Sandbox personas (`ALLOW_DEV_SANDBOX`).
- **Consequences**: TrustFlow never holds or discards user private keys on the server.

## ADR-004: Honest Provider Failures & Isolated Development Sandbox
- **Status**: Accepted (Phase 1)
- **Context**: Previous auth routes leaked `demoCode` in JSON, logged OTPs to stdout, accepted raw `{ email }` on `/api/auth/google`, and trusted unverified `{ privyUserId, stellarAddress }` on `/api/auth/privy-sync`.
- **Decision**:
  - Require cryptographic verification for Google ID tokens (RS256 via Google JWKS) and Privy access tokens (via Privy JWKS / verification key).
  - Return `503 Service Unavailable` when Email OTP transport, Google `GOOGLE_CLIENT_ID`, or Privy `PRIVY_APP_ID` is unconfigured.
  - Provide an explicit `POST /api/auth/sandbox` endpoint enabled **only** when `NODE_ENV !== "production"` and `ALLOW_DEV_SANDBOX=true`, clearly marked `isSandbox: true` in sessions, UI, and records.
- **Consequences**: Production deployments cannot be bypassed via unverified JSON payloads; developers and automated tests can still exercise full multi-party flows cleanly in sandbox mode.

## ADR-005: No Fake Financial Transitions in Phase 1
- **Status**: Accepted (Phase 1)
- **Context**: `AgreementDetailRoom.tsx` previously ran `setTimeout` simulations writing fake `tf-tx-*`/`tf-rel-*`/`tf-ref-*` hashes and updating `status` to `FUNDED`/`RELEASED`/`REFUNDED` through an open `POST /api/agreements` overwrite endpoint.
- **Decision**: Remove open `POST /api/agreements` updates and client-side financial simulations. Implement explicit non-financial transition endpoints (`accept`, `request-changes`, `fulfil`, `approve`, `cancel-request`, `cancel-withdraw`, `cancel-confirm`) with strict role checks, canonical hash checks, version checks, and post-acceptance immutability. Block client-claimed `FUNDED`, `RELEASED`, and `REFUNDED` transitions (`501`/`403`) until Phase 2 Trustless Work integration is live.
- **Consequences**: Agreement records cannot have spoofed financial states or unverified explorer links.

## ADR-006: Native Node `crypto` JWKS Verification & File Repository Locking
- **Status**: Accepted (Phase 1)
- **Decision**: Verify RSA/EC JWT signatures (`RS256`, `ES256`) using Node.js 22 native `crypto.createPublicKey({ key: jwk, format: "jwk" })` and `crypto.verify` with in-memory JWKS TTL caching, avoiding unrequested external dependencies. Serialize JSON file writes per repository file with atomic rename and optimistic version checks (`409 Conflict`).
- **Consequences**: Zero extra runtime packages needed for JWT verification; deterministic concurrency safety in Phase 1 before Phase 4 database migration.
