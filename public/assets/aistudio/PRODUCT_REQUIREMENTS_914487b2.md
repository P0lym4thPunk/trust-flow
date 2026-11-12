# Product Requirements

## Actors

- **Payer:** creates and funds an agreement.
- **Recipient:** accepts the agreement and fulfils the condition.
- **Approver:** confirms fulfilment where required.
- **Visitor:** views the public landing page and can launch the application.

A user may occupy more than one role in different agreements. Role permissions are transaction-specific.

## Feature inventory

### FEAT-001 — Landing and app entry

A concise public landing page explains the product and provides a clear launch-app action.

### FEAT-002 — Wallet connection

Connect a supported Stellar wallet, show the connected public address in shortened form and allow disconnect. Never request or collect seed phrases/private keys.

### FEAT-003 — Conversational agreement creation

User describes intent in natural language. Assistant asks only necessary follow-up questions and produces a structured draft.

### FEAT-004 — Transaction templates

Provide three selectable templates:

- Work
- Protected payment
- Conditional disbursement

Templates change terminology and relevant fields, not the underlying contract engine.

### FEAT-005 — Agreement review and acceptance

Show all material terms in plain language. Parties can accept or request edits. Material changes after acceptance require a new acceptance cycle.

### FEAT-006 — Funding

Payer reviews asset, amount, recipient, contract and network, then explicitly signs with their wallet. Display pending until confirmed on Stellar.

### FEAT-007 — Condition fulfilment

Recipient submits a delivery note, evidence link or completion message. Do not claim evidence is independently verified unless a verification integration exists.

### FEAT-008 — Approval

Only the contract-authorised approver can approve. Approval is an explicit signed transaction and must be confirmed on-chain.

### FEAT-009 — Release

Contract releases escrowed assets only when its own conditions pass. App verifies the transaction before showing completion.

### FEAT-010 — Cancellation/refund

Only permitted states and authorised parties can initiate cancellation/refund. Contract rules determine eligibility. No client-only refund state.

### FEAT-011 — Transaction tracking

Show agreements grouped by actionable state:

- Drafts
- Awaiting acceptance
- Awaiting funding
- Active
- Awaiting my review
- Completed
- Cancelled/Refunded
- Attention needed

### FEAT-012 — AI Agreement Builder

Structured output, clarifying questions, validation and human review.

### FEAT-013 — AI Agreement Checker

Checks completeness, clarity, contradictions, deadlines, approvers and condition wording.

### FEAT-014 — Activity timeline

Display recorded events with timestamp, actor, action and transaction reference where available.

## Functional requirements

- FR-001: A visitor can view the landing page and launch the app.
- FR-002: A user can connect and disconnect a supported Stellar wallet.
- FR-003: A user can choose one of the three transaction templates.
- FR-004: A user can describe a transaction in ordinary language.
- FR-005: The AI can ask clarifying questions for missing critical terms.
- FR-006: The server validates AI output against a strict schema.
- FR-007: The user can edit and confirm the draft.
- FR-008: The other party can review and accept or request changes.
- FR-009: The payer can initiate funding only after agreement acceptance.
- FR-010: The wallet displays a clear transaction confirmation before signing.
- FR-011: The app verifies the funding transaction before showing Funded.
- FR-012: The recipient can submit a completion note/evidence reference.
- FR-013: Only an authorised approver can approve.
- FR-014: The contract enforces release eligibility.
- FR-015: The app verifies release before showing Completed.
- FR-016: Users can view their own agreements and relevant activity.
- FR-017: Users cannot access another user's private agreement data without permission.
- FR-018: The AI checker identifies missing or ambiguous agreement terms.
- FR-019: Errors and pending states are visible and recoverable.
- FR-020: The interface is usable on mobile screens.

## Non-functional requirements

- NFR-001 Security: server-side authorization and input validation.
- NFR-002 Privacy: least-privilege access to personal and agreement data.
- NFR-003 Reliability: transaction states must be verified, not guessed.
- NFR-004 Accessibility: semantic controls, keyboard support and readable contrast.
- NFR-005 Responsiveness: phone-first layout with tablet/desktop adaptations.
- NFR-006 Maintainability: typed contracts, modular code and documented interfaces.
- NFR-007 Observability: structured logs without secrets or sensitive wallet material.
- NFR-008 Cost awareness: bounded AI calls, token limits, rate limits and user-visible failure fallback.

## MVP exclusions

No marketplace, public provider listings, social graph, live fiat on/off-ramp, mainnet payments, legal arbitration, automated oracle verification, token swaps, yield, lending or reputation scoring.