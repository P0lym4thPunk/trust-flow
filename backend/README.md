# TrustFlow — Backend Architecture & Integration Specification

This directory (`/backend`) constitutes the isolated, modular backend layer for **TrustFlow**, an AI-assisted universal escrow and conditional payments application on Stellar.

---

## 1. TrustFlow System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React 19 + Vite 8)                    │
│   • Conversational Workspace (AI Agreement Builder & Checker UI)       │
│   • Agreement Detail Room (State Timeline, Deliverable Submissions)   │
│   • Agreement List & Filtering (Status, Roles: Payer/Recipient/Review) │
│   • Wallet Connection / Session (Pollar / Privy / Freighter)           │
└─────────────────────────────────▲──┬───────────────────────────────────┘
                                  │  │ HTTP REST / JSON
                                  │  ▼
┌─────────────────────────────────┴──┴───────────────────────────────────┐
│                       EXPRESS BACKEND (/backend)                       │
│                                                                        │
│   [Routes & Controllers]                                               │
│     ├── /api/agreements  (CRUD, Acceptance, Status Sync)               │
│     ├── /api/ai          (Prompt -> Schema, Drafting, Term Audit)      │
│     ├── /api/escrow      (Prepare Escrow, Funding Verification, Tx)   │
│     └── /api/user        (Profiles, Sessions, Public Key Association)  │
│                                                                        │
│   [Domain Services]                                                    │
│     ├── AgreementService (Business Logic, Validation, State Machine)   │
│     └── AiService        (Gemini 3.8 Flash + Safety & Fallback Engine) │
│                                                                        │
│   [Integration Adapters]                                               │
│     ├── TrustlessWorkAdapter (Trustless Work Escrow V1 Interface)      │
│     ├── PollarAdapter        (Pollar / Privy Session & Signer Proxy)   │
│     └── StellarRpcAdapter    (Horizon & Soroban RPC Verification)      │
└───────────────▲─────────────────▲────────────────────────▲─────────────┘
                │                 │                        │
                ▼                 ▼                        ▼
┌───────────────────────┐ ┌───────────────┐ ┌────────────────────────────┐
│   OFF-CHAIN STORAGE   │ │   AI ENGINE   │ │   ON-CHAIN / ESCROW RAILS  │
│ (PostgreSQL / Supabase│ │ Google Gemini │ │                            │
│    + Local JSON Demo) │ │   via @genai  │ │ • Trustless Work Escrow V1 │
│                       │ │               │ │ • Stellar Testnet Horizon  │
│ • User Profiles       │ │ • Term Parse  │ │ • Soroban Smart Contracts  │
│ • Draft Agreements    │ │ • Clarity     │ │ • Real Asset Locking       │
│ • Activity History    │ │   Audit       │ │ • Authoritative Balances   │
│ • Deliverable Evidence│ │               │ │ • On-Chain Settlement      │
└───────────────────────┘ └───────────────┘ └────────────────────────────┘
```

---

## 2. Frontend-to-Backend API Communication Design

### A. Agreement Endpoints
| Method | Path | Request Body | Purpose | Response |
|---|---|---|---|---|
| `GET` | `/api/agreements` | None | Fetch all agreements visible to current user | `AgreementRecord[]` |
| `GET` | `/api/agreements/:id` | None | Fetch single agreement by ID | `AgreementRecord` |
| `POST` | `/api/agreements` | `Partial<AgreementRecord>` | Create or update agreement draft | `AgreementRecord` |
| `POST` | `/api/agreements/:id/accept` | `{ role: "PAYER" \| "RECIPIENT", actor: string }` | Record counter-party acceptance | Updated `AgreementRecord` |

### B. AI Assistance Endpoints
| Method | Path | Request Body | Purpose | Response |
|---|---|---|---|---|
| `POST` | `/api/ai/draft` | `{ prompt: string, transactionType: string, userRole: string }` | Converts natural language intent into structured agreement parameters | Structured agreement draft + clarification status |
| `POST` | `/api/ai/check` | `{ terms: AgreementTerms }` | Audits agreement for missing terms, vague deliverables, and unfair rules | `{ overallStatus: "PASS" \| "NEEDS_REVISION" \| "BLOCKING_ISSUES", findings: Finding[] }` |

### C. Escrow & On-Chain Endpoints
| Method | Path | Request Body | Purpose | Response |
|---|---|---|---|---|
| `POST` | `/api/escrow/prepare` | `{ agreementId: string }` | Prepares parameters/XDR for Trustless Work contract interaction | `{ prepared: boolean, contractAddress: string, metadata: object }` |
| `POST` | `/api/escrow/:id/fund` | `{ txHash: string, payerAddress: string }` | Confirms funding, verifies hash on Stellar, transitions state to `FUNDED` | `{ agreement: AgreementRecord, onChainVerification: object }` |
| `POST` | `/api/escrow/:id/fulfil` | `{ description: string, links: string[], actor: string }` | Submits deliverable evidence, moves state to `AWAITING_APPROVAL` | Updated `AgreementRecord` with evidence |
| `POST` | `/api/escrow/:id/release` | `{ txHash: string, actor: string }` | Approver releases funds to recipient; logs transaction | Completed `AgreementRecord` |
| `GET` | `/api/escrow/tx/:hash/verify` | None | Queries Stellar Horizon to verify transaction success and ledger height | `{ confirmed: boolean, ledger: number, successful: boolean }` |

---

## 3. Database vs. On-Chain Responsibility Matrix

| Area | Stored Off-Chain (Database) | Stored On-Chain (Stellar / Trustless Work) |
|---|---|---|
| **Identity** | Display names, emails, avatars, notification prefs | Stellar public key (G...), contract addresses |
| **Agreement** | Natural language description, deliverable files/links, draft iterations | Canonical agreement SHA-256 hash, contract ID |
| **Funds** | Cached display balances, transaction history summary | Real locked tokens (USDC/XLM), escrow balance |
| **State** | Application state cache (`FUNDED`, `AWAITING_APPROVAL`) | Authoritative contract state (Funded, Released, Refunded) |
| **Actions** | User activity log, messages, evidence links | Signed transactions, cryptographic signatures |

---

## 4. Unresolved Dependencies & Verification Checklists

### Checklist A: Userouter Identification
- **Current Finding:** No package or SDK named `Userouter` exists in the Stellar, Soroban, or npm ecosystems.
- **Hypothesis:** Highly likely a typographical confusion with Next.js client router (`useRouter`) or `@creit-tech/stellar-router-sdk`.
- **Status:** **DO NOT IMPORT**. Kept out of runtime dependencies until documentation or repository link is provided.

### Checklist B: Pollar / Privy Credentials
- **Provider Identity:** Pollar (`pollar.xyz` / `@pollar/core`) with `@pollar/privy-server-adapter`.
- **Backend Credentials:** `PRIVY_APP_SECRET` and `POLLAR_API_KEY` (MUST NEVER be exposed to frontend).
- **Frontend Safe:** `PRIVY_APP_ID` / `POLLAR_APP_ID` for rendering the login modal.
- **Auth Flow:** Email/password or social login -> Privy derives or manages embedded keypair -> backend signs or proxies Stellar transactions without exposing user seed phrases.

### Checklist C: Trustless Work V1 Testnet Integration
- **Engine Identity:** Trustless Work (`trustlesswork.com`, `@trustless-work/escrow`, `trustlesswork-smart-contract-stellar`).
- **Contract Platform:** Soroban smart contracts on Stellar Testnet.
- **Roles:** Payer (depositor), Recipient (earner), Approver (designated reviewer).
- **Supported Operations:**
  1. Initialize escrow with contract parameters (Payer, Recipient, Approver, Amount, Asset).
  2. Fund escrow (deposit token transfer).
  3. Submit deliverable / mark ready.
  4. Approve & Release funds to recipient.
  5. Cancel / Refund (mutual or expired deadline).
