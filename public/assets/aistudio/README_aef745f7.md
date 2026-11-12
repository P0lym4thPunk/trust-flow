# TrustFlow — Project Blueprint

**Product:** TrustFlow  
**Description:** An AI-assisted universal escrow and conditional-payments application on Stellar.  
**Status:** Product direction approved; design references pending; implementation not started.  
**Environment:** Stellar testnet-first prototype.

## 1. Project purpose

TrustFlow makes protected payments easier to create, understand and manage.

Users should not need to understand blockchain terminology, smart contracts, claimable balances or transaction mechanics to use the application.

They should be able to describe what they want to do in ordinary language, receive help creating a clear agreement, review its conditions, and complete the supported payment actions through a simple interface.

The agreement is the centre of the application. Soroban smart contracts enforce the payment conditions. The AI assistant helps users understand and prepare agreements, but it never controls funds or signs transactions.

## 2. How to use these project files

These Markdown documents are the persistent product and engineering instructions for the AI coding agent.

1. Add all the Markdown files to the Google AI Studio project.
2. Upload the UI reference images you want the application to follow.
3. Start with `GOOGLE_AI_STUDIO_MASTER_PROMPT.md`.
4. The agent must read `AGENT_INSTRUCTIONS.md`, `PROJECT_STATUS.md`, `DECISIONS.md` and `MASTER_PROJECT_SPECIFICATION.md` before implementation.
5. The agent must then read the supporting product, design, technical, implementation and QA documents.
6. The uploaded images are the visual reference for the interface. The agent must inspect them before deciding the final visual system.
7. The agent should work in stages, verify its work and update `PROJECT_STATUS.md` as it progresses.

Do not ask the agent to generate the entire application in one uncontrolled pass.

## 3. Document map

### Root files

- `README.md` — project overview and document map.
- `AGENT_INSTRUCTIONS.md` — operating rules for the AI coding agent.
- `DECISIONS.md` — approved product and technical decisions.
- `PROJECT_STATUS.md` — current project state, completed work and next actions.
- `MASTER_PROJECT_SPECIFICATION.md` — authoritative description of the complete product.
- `GOOGLE_AI_STUDIO_MASTER_PROMPT.md` — starting prompt that instructs Google AI Studio to ingest the files and carry out the project in stages.

### Product specifications

- `product/PRODUCT_REQUIREMENTS.md` — product purpose, users, features, MVP scope and acceptance criteria.
- `product/USER_JOURNEYS.md` — the journeys users follow when creating and completing agreements.
- `product/BUSINESS_RULES.md` — agreement rules, payment conditions and lifecycle transitions.

### Design specifications

- `design/UX_AND_INTERFACE_SPEC.md` — mobile-first interface structure, navigation and interaction behaviour.
- `design/DESIGN_REFERENCE_PROTOCOL.md` — instructions for interpreting and applying uploaded UI reference images.

### Technical specifications

- `technical/SYSTEM_ARCHITECTURE.md` — application architecture, technology stack and repository structure.
- `technical/SOROBAN_CONTRACT_SPEC.md` — smart contract responsibilities, states, permissions and expected behaviour.
- `technical/AI_ASSISTANT_SPEC.md` — TrustFlow Assistant identity, knowledge boundaries, prompt-injection protections and AI workflows.
- `technical/DATABASE_AND_API_SPEC.md` — Supabase data model, server-side API responsibilities and data relationships.
- `technical/SECURITY_AND_PRIVACY.md` — authentication, authorisation, secrets, wallet safety and data protection.

### Implementation and deployment

- `implementation/BUILD_AND_VERIFICATION_PLAN.md` — staged development process and readiness gates.
- `qa/TEST_STRATEGY.md` — contract, application, AI, security and end-to-end testing.
- `deployment/ENVIRONMENT_AND_DEPLOYMENT.md` — environment configuration, Vercel deployment and testnet setup.

## 4. Source-of-truth hierarchy

If two documents or instructions disagree, use this hierarchy:

1. Explicit decisions approved by the user and recorded in `DECISIONS.md`.
2. `MASTER_PROJECT_SPECIFICATION.md`.
3. The relevant supporting specification.
4. Approved uploaded design reference images for visual appearance.
5. Existing implementation code.

Do not silently resolve a meaningful conflict. Explain it and identify the smallest decision needed.

## 5. Project reporting terminology

The AI coding agent must use these labels when reporting progress:

- **CONFIRMED** — explicitly approved by the user.
- **RESEARCHED** — supported by external documentation or credible technical sources.
- **VERIFIED** — directly checked in the current project, runtime or test.
- **PROPOSED** — a recommendation that has not yet been approved.
- **INFERRED** — a reasonable assumption that has not been confirmed.
- **UNKNOWN** — not established.
- **BLOCKED** — work cannot safely continue until a dependency is resolved.

The agent must never claim that a feature is implemented, tested, deployed or secure without evidence.