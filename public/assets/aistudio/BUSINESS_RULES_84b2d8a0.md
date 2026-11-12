# Business Rules

## Agreement model

Every agreement has:

- Unique application ID.
- Transaction category: `WORK`, `PROTECTED_PAYMENT` or `CONDITIONAL_DISBURSEMENT`.
- Payer and recipient Stellar public addresses.
- Optional approver address list and required approval threshold.
- Asset identifier and amount in the asset's smallest supported unit.
- Human-readable title and description.
- Condition description.
- Deadline/expiry policy.
- Cancellation and refund policy.
- Version number and immutable accepted-version reference.
- Status and timestamps.
- Optional evidence references.
- On-chain contract instance/escrow identifier and transaction hashes.

## State model

Suggested application states:

- `DRAFT`
- `AWAITING_ACCEPTANCE`
- `CHANGES_REQUESTED`
- `AWAITING_FUNDING`
- `FUNDING_PENDING`
- `FUNDED`
- `FULFILMENT_SUBMITTED`
- `AWAITING_APPROVAL`
- `RELEASE_PENDING`
- `COMPLETED`
- `CANCEL_REQUESTED`
- `REFUND_PENDING`
- `REFUNDED`
- `EXPIRED`
- `DISPUTED` (only when a real dispute state exists in the contract)

The contract may use a smaller state enum. Map contract states to UI states explicitly. Never store a UI-only status as proof of on-chain state.

## Invariants

1. The payer and recipient must be valid distinct Stellar addresses unless a future approved use case explicitly permits otherwise.
2. The asset and amount must be supported by the contract.
3. Amount must be positive and within verified asset precision/contract bounds.
4. The agreement version funded by the payer must be the same version accepted by the required parties.
5. Funding must be confirmed before the app shows Funded.
6. Release must be authorised by the contract's rule set.
7. Refund must be authorised by contract rules and current state.
8. The same escrow cannot be released twice.
9. Duplicate requests must be handled idempotently where possible.
10. AI-generated fields are proposals, not trusted inputs.
11. Off-chain evidence does not automatically prove a condition.
12. A change to material terms invalidates prior acceptance.

## Approval conditions

- **Single approval:** one specified address is authorised.
- **Multiple approval:** define the exact threshold and eligible approvers; ensure duplicate approvals do not count twice.
- **Time condition:** use the ledger timestamp/time semantics documented for Soroban; define whether the recipient may claim after a time or whether another action is required.
- **Combined conditions:** defer unless contract logic and tests explicitly cover them.

## Cancellation/refund policy

Do not invent a universal refund rule. Each template must present a clear policy before acceptance. Contract implementation must enforce allowed cancellation/refund states and actors.

If the policy cannot be implemented safely in the MVP, remove that option from the UI rather than simulate it.

## Fee and transaction display

Show network fees only when they can be accurately obtained or estimated. Distinguish network fees from any application fee. Do not invent a TrustFlow fee. Display asset symbol, network and amount clearly.