
### 12. `technical/SOROBAN_CONTRACT_SPEC.md`

```markdown
# Soroban Escrow Contract Specification

## Purpose

Implement one reusable Soroban contract that holds supported Stellar assets and enforces agreement-based release/refund rules. The contract is the authority for escrowed balances and state transitions.

This document defines expected behaviour, not a substitute for checking current Soroban APIs. The coding agent must verify the current official Soroban documentation and examples before implementing.

## Contract technology

- Rust.
- `soroban-sdk`.
- Stellar testnet deployment for prototype.
- A supported Stellar token contract implementing the relevant token interface.
- JavaScript interaction through `@stellar/stellar-sdk` and Soroban RPC, using current documented APIs.

Do not invent contract client method names or SDK APIs. Generate bindings using the currently supported Soroban tooling where applicable.

## Conceptual contract record

Each escrow record should include:

- `escrow_id`
- payer address
- recipient address
- optional approver addresses
- approval threshold
- token contract address
- amount
- agreement hash/version reference
- condition mode
- deadline/expiry timestamp where applicable
- lifecycle state
- created/funded/released/refunded timestamps
- evidence reference hash or compact reference only if needed

Do not store large agreement documents or private evidence in contract storage. Store a compact immutable agreement digest/reference; keep readable content off-chain with access controls.

## Required conceptual operations

The exact exported function signatures must be designed after inspecting Soroban examples and token interfaces.

- Initialize contract configuration if required.
- Create escrow/agreement commitment.
- Fund escrow using an authorised token transfer mechanism.
- Record recipient acceptance if contract-enforced acceptance is required.
- Submit fulfilment/ready-for-review state if needed.
- Approve condition by an authorised approver.
- Record multiple approvals without double-counting an address.
- Release funds to recipient when all contract conditions pass.
- Cancel/refund only in explicitly permitted states.
- Read escrow state and relevant configuration.

## Funding model

Use the supported token contract interface and allowance/transfer mechanism correctly. The payer must explicitly authorise token movement through their wallet.

Do not invent a token contract address or assume a particular testnet USDC contract exists. Verify the chosen test asset and decimals before implementing.

## Release conditions

MVP target:

1. Single designated approval.
2. Time-based release only if the chosen semantics are clearly defined and verified.
3. Multiple approval threshold only if implemented and thoroughly tested; otherwise mark it as a later capability.

The contract must enforce:

- Caller authorisation.
- Correct state.
- Correct approval threshold.
- No duplicate release.
- No duplicate approval counting.
- Correct asset and amount.
- Deadline semantics.
- Reentrancy/state-order safety appropriate to Soroban execution.
- Correct refund/cancellation rules.

A contract cannot objectively determine whether a physical item was delivered or a design is good unless a real oracle/attestation mechanism exists. In the MVP, human approval is the condition.

## State transitions

Proposed conceptual lifecycle:

`CREATED → FUNDED → SUBMITTED/READY_FOR_REVIEW → APPROVED → RELEASED`

Alternative permitted transitions may include:

`CREATED → CANCELLED`

`FUNDED → REFUNDABLE → REFUNDED`

`FUNDED → EXPIRED` only if the contract defines a safe consequence.

Define a complete transition table before implementation, including caller, preconditions, effects and emitted events.

## Events and indexing

Emit events for important state transitions. The backend/indexer should verify them against transaction/ledger results before updating UI projections. Event names and payloads must be documented.

## Contract tests

At minimum test:

- Valid creation.
- Invalid addresses/amounts.
- Unsupported asset.
- Funding success and failure.
- Only payer can fund.
- Only authorised approver can approve.
- Unauthorized release fails.
- Release before condition fails.
- Release after valid condition succeeds.
- Double release fails.
- Duplicate approval does not increase threshold.
- Incorrect approval threshold fails.
- Refund/cancellation only in allowed states.
- Expiry/time boundary conditions.
- State remains unchanged after failed calls.
- Different escrow instances do not interfere.
- Token transfer failure is handled safely.

## Critical rule

Never represent an off-chain AI judgement as an on-chain condition. AI may explain or check agreement wording. Only explicit authorised wallet-signed actions and contract rules may change escrow state.