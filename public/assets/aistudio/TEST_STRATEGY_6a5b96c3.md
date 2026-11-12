# Test Strategy

## Test layers

1. Unit tests: schemas, formatting, status mapping, business rules.
2. Contract tests: Soroban state transitions, permissions, token movement and edge cases.
3. API integration tests: authentication, authorization, Gemini output validation and Supabase access.
4. Wallet integration tests: connect, sign, reject, submit, verify.
5. End-to-end tests: full user journeys.
6. Visual tests: responsive layout and reference fidelity.
7. Security tests: prompt injection, access control, secret exposure and transaction authorization.

## Core test cases

### Agreement and AI

- TC-001: Complete natural-language request produces a draft.
- TC-002: Missing recipient/amount/asset/condition triggers clarification.
- TC-003: Ambiguous deliverable is flagged.
- TC-004: Contradictory dates/conditions are flagged.
- TC-005: Unsupported transaction type is rejected or redirected.
- TC-006: Malformed model response is rejected.
- TC-007: Prompt injection in user text does not change assistant scope.
- TC-008: AI does not invent wallet addresses, asset addresses or dates.

### Authorization

- TC-009: Non-participant cannot read private agreement.
- TC-010: Unverified wallet cannot accept for another address.
- TC-011: Non-approver cannot approve.
- TC-012: AI endpoint cannot invoke contract actions.

### Contract and wallet

- TC-013: Valid payer can fund.
- TC-014: Funding with wrong asset/amount fails.
- TC-015: Unauthorized account cannot release.
- TC-016: Release before condition fails.
- TC-017: Valid approval enables release.
- TC-018: Double release fails.
- TC-019: Duplicate approver does not count twice.
- TC-020: Refund only succeeds in permitted state.
- TC-021: Wallet rejection leaves agreement unfunded.
- TC-022: RPC timeout does not create a false success state.
- TC-023: App verifies transaction before showing funded/released.

### Interface

- TC-024: Landing page launch action works.
- TC-025: Mobile navigation drawer opens, closes and routes.
- TC-026: Wallet/profile controls remain accessible on mobile.
- TC-027: Composer supports send/loading/error/retry.
- TC-028: Agreement preview is editable.
- TC-029: All visible controls have meaningful behaviour.
- TC-030: Empty, pending, success and failure states render correctly.

## Demo acceptance

A credible testnet demo should show:

- Wallet A and Wallet B are separate test accounts.
- Agreement is generated and checked.
- Both parties accept the same agreement version.
- Payer signs a real testnet funding transaction.
- Application verifies funding on Stellar.
- Recipient submits fulfilment information.
- Authorised approver signs approval.
- Contract releases the test asset.
- Application verifies release and displays the transaction reference.

No mocked transaction success may be presented as a real on-chain result.