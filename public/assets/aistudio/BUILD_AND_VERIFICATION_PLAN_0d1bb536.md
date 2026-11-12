# Build and Verification Plan

Use staged implementation. Do not issue one giant instruction to build every feature simultaneously.

## Stage 0 — Ingest and audit

- Read all project Markdown files.
- Inspect all uploaded UI reference images.
- Inspect repository if one exists.
- Identify missing inputs and contradictions.
- Produce a source inventory, design reference audit, repository audit and risk list.
- Do not make major code changes.

**Gate:** Agent demonstrates it understands the requirements and reference images.

## Stage 1 — Technical verification and architecture

- Verify current official documentation for Next.js, Vercel, Supabase, Gemini API, Stellar SDK, Stellar Wallets Kit, Soroban SDK and Soroban RPC.
- Verify current package versions and compatibility.
- Confirm testnet asset availability and token contract address.
- Confirm wallet signing flow.
- Define contract interface, state transitions and database migrations.
- Produce a dependency map and implementation sequence.

**Gate:** No guessed API methods, package versions, token addresses or network endpoints.

## Stage 2 — Foundation and design integration

- Create/inspect Next.js application structure.
- Configure TypeScript, Tailwind and lint/test scripts.
- Integrate the approved reference-derived design system.
- Build landing page, app shell, responsive navigation and conversational workspace.
- Build reusable agreement card and transaction status components.
- Use realistic fixture data for visual work, clearly labelled as demo data.

**Gate:** Main screens render responsively and match the approved visual references before blockchain integration.

## Stage 3 — Data and identity foundation

- Configure Supabase project and migrations.
- Implement authentication decision.
- Implement RLS and server-side access checks.
- Add typed data contracts and repository/data-access layer.
- Test participant-scoped access.

**Gate:** Database and identity access tests pass.

## Stage 4 — Soroban contract

- Implement contract with Rust and `soroban-sdk`.
- Add unit tests for state transitions, permissions, token movement and failure cases.
- Build/test locally using documented tooling.
- Deploy to Stellar testnet.
- Record contract ID and network.
- Verify deployed contract behaviour using test accounts and test assets.

**Gate:** Contract tests pass and testnet create/fund/release path is verified.

## Stage 5 — Wallet and Stellar integration

- Integrate Stellar Wallets Kit.
- Connect/disconnect and display address/network.
- Build and simulate/preflight transactions using current documented SDK methods.
- Request wallet signature only after explicit user action.
- Submit and verify transaction.
- Handle pending, failed, rejected and confirmed states.

**Gate:** Two separate test wallets complete the transaction flow; verified hashes and explorer links are shown.

## Stage 6 — AI integration

- Implement TrustFlow system instruction/prompt version.
- Add curated product knowledge.
- Implement server-side Gemini client.
- Implement Agreement Builder with structured output.
- Implement server-side schema/business-rule validation.
- Implement Agreement Checker.
- Add rate limiting, request limits, logging and prompt-injection tests.
- Keep all transaction tools inaccessible to the model.

**Gate:** AI evaluation tests pass and malformed/hostile prompts cannot bypass application validation.

## Stage 7 — Complete transaction journeys

- Connect all three transaction templates to the same engine.
- Implement agreement review, acceptance, funding, submission, approval, release and permitted refund flow.
- Add transaction tracking and activity timeline.
- Verify Supabase projections against chain data.
- Ensure all controls are functional.

**Gate:** End-to-end test passes for each supported transaction type.

## Stage 8 — Independent QA and refinement

- Run typecheck, lint, unit, integration, contract and E2E tests.
- Test phone, tablet and desktop layouts.
- Compare UI to reference images.
- Test accessibility basics.
- Test failure recovery and duplicate actions.
- Review security checklist.
- Fix root causes, not symptoms.

**Gate:** No known critical defects; report remaining limitations honestly.

## Stage 9 — Deployment and handover

- Configure Vercel environment variables.
- Configure Supabase production/staging settings separately.
- Confirm testnet configuration remains explicit.
- Deploy preview.
- Run smoke tests.
- Document repository, contract ID, network, environment variables, test commands and known issues.
- Do not deploy mainnet or enable real funds.

## Seven-prompt execution mapping

If the agent workflow is organised into seven coding prompts:

1. Ingest/audit.
2. Technical verification and architecture.
3. Foundation/design integration.
4. Frontend and user journeys.
5. Backend, AI, wallet and contract integrations.
6. Independent QA and correction.
7. Deployment readiness and handover.

The stages above may be split into more messages if the tool's context or output limits require it. Do not compress complex security or contract work just to preserve a prompt count.