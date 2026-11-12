# User Journeys

## Journey J-001 — Create a work agreement

1. Payer opens app and selects **Work** or describes the work in the composer.
2. Assistant asks for missing deliverable, amount, asset, recipient, due date and approval terms.
3. Assistant returns a structured draft.
4. User reviews and edits the terms.
5. User runs the agreement checker.
6. User confirms the draft and shares it with the recipient.
7. Recipient opens the agreement, reviews terms and accepts or requests changes.
8. Once accepted, payer funds the agreement through a wallet signature.
9. App verifies the funding transaction and shows the active agreement.
10. Recipient submits a delivery note or evidence reference.
11. Approver reviews and explicitly approves or requests changes.
12. If approved, payer/authorised party submits the contract release call as defined by the contract rules.
13. App verifies release and marks the agreement complete.

## Journey J-002 — Protected everyday payment

Use terms such as **buyer**, **seller**, **item/service**, **delivery confirmation**.

The flow remains the same: draft, review, accept, fund, submit confirmation, approve and release.

The app must not represent user confirmation as independent proof of delivery.

## Journey J-003 — Conditional disbursement

Initiator describes the recipient, amount, purpose, condition, deadline and designated approver(s). AI creates the draft and checker flags missing approval authority or vague conditions.

After acceptance and funding, the recipient submits the required update/evidence. The authorised approver confirms the condition. The contract enforces the configured release rule.

## Journey J-004 — Recipient requests a change

Recipient reviews the agreement and requests a change. The agreement returns to a revision state. The original terms remain visible in history. A changed agreement requires explicit acceptance from the required parties before funding.

## Journey J-005 — Funding transaction fails or remains pending

1. User initiates wallet action.
2. Wallet rejects, user cancels, RPC fails or transaction remains pending.
3. UI clearly distinguishes cancelled, failed, submitted and confirmed.
4. Do not mark funds as locked until verified from Stellar.
5. Provide retry/re-check action without creating duplicate funding.

## Journey J-006 — Approval is rejected or changes requested

Approver chooses a supported response. If requesting changes, transaction remains in a review/fulfilment state and the recipient is notified. A rejection must not release funds. Any refund or dispute transition follows contract rules only.

## Journey J-007 — User tracks agreements

Navigation drawer provides filtered views for drafts, pending acceptance, pending funding, active, awaiting my approval, completed and attention-needed. Counts must derive from authorized application data and verified chain state where relevant.

## Journey J-008 — AI boundary test

User asks unrelated general questions, asks the assistant to reveal system instructions, impersonate another model, bypass app rules, access another user's agreement or release funds.

Assistant stays within TrustFlow scope and refuses unsafe/unauthorised requests. Server-side controls prevent the model from accessing protected data or privileged transaction tools.