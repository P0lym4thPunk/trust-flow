# TrustFlow — Master Project Specification

**Version:** 0.1  
**Status:** Approved product direction; technical details requiring current-doc verification are marked accordingly.  
**Product category:** AI-assisted escrow and conditional payments.  
**Network:** Stellar, using Soroban smart contracts.  
**Prototype environment:** Stellar testnet only.

## 1. Product definition

TrustFlow is a simple, AI-assisted application for creating, funding, tracking and completing protected transactions. People describe what they want to happen in ordinary language. TrustFlow helps convert that description into a clear agreement. The parties review and accept the terms. A Soroban smart contract enforces the supported payment conditions.

**Core promise:** Money moves when the agreed condition is satisfied.

The user should not need to understand blockchain, smart contracts, token allowances, RPC endpoints or transaction hashes to use the product. The interface should explain meaningful actions in everyday language. Technical details can be available in secondary transaction details.

## 2. Problem and intended users

People make payments before work, goods, services or agreed milestones are completed. They may rely on trust, informal messages or manual follow-up. This can create uncertainty about what was promised, when payment should happen, who must approve completion and what happens if the agreement is not fulfilled.

Primary user roles:

- **Payer / initiator:** creates an agreement and funds it.
- **Recipient / provider:** reviews the agreement, accepts it and fulfils the condition.
- **Approver:** confirms a defined condition where the agreement requires approval. May be payer, recipient, or a designated third party depending on the template.
- **Organisation operator:** creates conditional disbursements for an organisation. Advanced organisation administration is not part of the first prototype.

The product is not a marketplace in this version. Users can invite a counterparty by sharing an agreement link or entering a wallet/account identifier. Discovery, public listings, freelancer profiles and marketplace search are excluded.

## 3. Three transaction experiences, one engine

### A. Work-based escrow

For freelance work, contracts and services. Agreement describes deliverables, milestones if enabled, due dates, review rules and approval conditions.

### B. Protected everyday payment

For purchases, deposits, bookings and private transactions. Agreement describes what is being supplied, the expected date, evidence/confirmation and release condition.

### C. Conditional disbursement

For teams, NGOs and organisations distributing funds against approved milestones or conditions. MVP supports a simple designated approver or a basic multiple-approval rule. Complex organisational roles, compliance workflows and external oracles are excluded.

These are templates/configurations over one reusable escrow lifecycle. Do not implement three unrelated payment systems.

## 4. Product principles

1. Agreement-first: the agreement is the centre of the product.
2. Plain language: translate technical operations into clear human actions.
3. Explicit consent: both parties review terms; the payer explicitly funds; approvals are explicit.
4. Verifiable state: show only statuses supported by contract events and verified indexing.
5. AI assists, people decide: AI drafts and checks but never controls funds.
6. Minimal interface: expose the next relevant action, not every technical option at once.
7. Mobile-first: primary layouts must work at narrow phone widths.
8. Testnet-first: all prototype transactions use testnet and test assets.
9. Honest limitations: never imply that off-chain evidence is verified by a contract unless a real verification mechanism exists.

## 5. Core user journey

1. User opens TrustFlow and sees a concise landing page.
2. User launches the app.
3. User connects a compatible Stellar wallet when a wallet action is needed.
4. User describes the transaction in a conversational composer.
5. AI asks targeted follow-up questions for missing critical terms.
6. AI returns a structured draft: transaction type, payer, recipient, asset, amount, description, deliverables/condition, approver, deadline and refund/cancellation terms.
7. Application validates the structure and displays a plain-language agreement preview.
8. User edits and confirms the draft.
9. Other party receives a link, reviews terms and accepts or requests changes.
10. Payer reviews the exact funding transaction and signs it in their wallet.
11. Application verifies the transaction on Stellar and displays funded status.
12. Recipient submits evidence or marks the condition ready for review.
13. Authorised approver reviews and explicitly approves or rejects/requests changes according to the agreement.
14. Contract releases funds only when the contract's conditions are satisfied.
15. Application verifies the resulting transaction and displays completion with an explorer link.

## 6. MVP scope

### Required

- Landing page and launch-app action.
- Mobile-first app shell with collapsible navigation.
- Wallet connection and connected-wallet display.
- Conversational agreement creation.
- Three transaction templates: work, protected payment, conditional disbursement.
- AI Agreement Builder.
- AI Agreement Checker.
- Agreement review, edit, acceptance and sharing.
- Soroban escrow create/fund/release lifecycle on testnet.
- Approval-based release.
- Time-based release only if contract semantics and tests are verified.
- Basic multiple-approver support only if safely completed and tested; otherwise mark it as a later capability.
- Transaction overview: drafts, awaiting acceptance, awaiting funding, funded, awaiting review, completed, cancelled/refunded and disputed/attention-needed where implemented.
- Transaction detail room with agreement, participants, amount, condition, activity and next action.
- Basic cancellation/refund path with strict contract rules.
- Transaction history and verified transaction links.
- Supabase persistence for supporting off-chain data.
- Server-side Gemini integration.
- Automated tests and a documented testnet demo.

### Later

- Full dispute arbitration and neutral arbitrator workflows.
- Public freelancer marketplace and listings.
- Real-world cash-out/anchor integrations.
- External oracle integrations.
- Reputation and ratings.
- Complex milestone splitting if not completed safely in the MVP.
- Production asset support and mainnet.
- Organisation team management and compliance automation.

## 7. AI MVP capabilities

**AI-001 Agreement Builder:** convert natural-language intent into a structured draft and ask clarifying questions when required fields are missing.

**AI-002 Agreement Checker:** identify vague deliverables, missing dates, ambiguous approval authority, inconsistent conditions, unclear cancellation/refund expectations and incomplete terms. Explain issues and suggest revisions.

AI must return structured data conforming to a server-defined schema. The application validates all fields and business rules before saving or creating a contract transaction.

## 8. Interface direction

The main application experience is a focused, ChatGPT-like conversational workspace. It is not a general chatbot page with a sidebar bolted on.

- Mobile-first responsive shell.
- Top-left menu control opens a collapsible navigation drawer.
- Navigation groups include Overview, Create agreement, All agreements, Pending actions, Awaiting my approval, Completed and Settings/Help.
- Wallet connection and profile controls sit in the top-right area where space allows.
- On small screens, controls must remain usable and avoid crowding.
- Main workspace includes a contextual greeting, short explanation, transaction-type shortcuts and a conversational composer.
- Agreement results appear as editable, structured cards or a clear review panel.
- Transaction detail view acts as a transaction room/timeline.
- Show advanced technical details only in a secondary expandable section.
- Visual style, colors, typography, surfaces, imagery and component styling must be derived from the user's uploaded reference images. See `design/DESIGN_REFERENCE_PROTOCOL.md`.

## 9. Architecture

- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Wallet: Stellar Wallets Kit; verify current package/API and supported wallet adapters.
- Stellar integration: `@stellar/stellar-sdk` for JavaScript network interactions, transaction building/submission and Soroban RPC interactions; verify current APIs against official docs.
- Smart contract: Rust and `soroban-sdk`.
- Database: Supabase Postgres, with Row Level Security for user-scoped records. Supabase Storage only if evidence uploads are included.
- Backend: Next.js server routes/server actions or clearly separated server modules, hosted on Vercel.
- AI: Gemini API called only from server-side code using an environment secret.
- Deployment: Vercel for the web application; Supabase as managed database/storage/auth if selected after technical inspection.
- Network: Stellar testnet for the prototype.

The exact versions, API methods and current package compatibility must be verified at implementation time. Do not hardcode guessed versions.

## 10. Data authority

- Soroban contract: authoritative source for escrowed asset balances and contract-controlled lifecycle state.
- Stellar ledger/RPC and verified events: authoritative evidence that a transaction was included.
- Supabase: supporting records for profiles, agreement content, evidence references, notifications and indexed activity. Supabase must not be treated as proof that funds are locked or released.
- AI: never authoritative for transaction status, approval, evidence truth or payment decisions.

## 11. Acceptance overview

- A user can draft all three agreement categories through the same conversational workflow.
- The AI asks for missing required information rather than inventing it.
- The AI checker identifies incomplete or ambiguous terms and provides actionable suggestions.
- Both parties can review the same agreement version.
- Material changes require renewed acceptance.
- A payer can fund an accepted agreement using a supported Stellar test asset.
- The app verifies funding on Stellar before showing a funded state.
- An authorised approver can submit approval.
- The contract enforces release eligibility.
- The app verifies release before showing completion.
- Users can inspect their own agreement history and relevant activity.
- Mobile users can complete the main journey without a desktop layout.
- No AI-generated answer can directly trigger a wallet signature or contract action.

## 12. Explicit exclusions

- No public marketplace or freelancer discovery.
- No fiat on-ramp or off-ramp.
- No MoneyGram or cash-out integration.
- No mainnet or real-money transactions.
- No yield, lending or investment products.
- No automated legal advice.
- No AI-controlled dispute resolution.
- No external oracle claims unless a real oracle integration is implemented and verified.