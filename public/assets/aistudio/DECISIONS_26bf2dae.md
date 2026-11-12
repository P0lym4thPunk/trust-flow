# TrustFlow — Decisions and Open Questions

## Approved decisions

| ID | Decision | Status |
|---|---|---|
| DEC-001 | Product is universal escrow and conditional payments, not a marketplace | CONFIRMED |
| DEC-002 | Support work-based escrow, protected everyday payments and conditional disbursement | CONFIRMED |
| DEC-003 | Use one reusable Soroban escrow engine | CONFIRMED |
| DEC-004 | Use Soroban smart contracts, Rust and `soroban-sdk` | CONFIRMED |
| DEC-005 | AI Agreement Builder is MVP | CONFIRMED |
| DEC-006 | AI Agreement Checker is MVP | CONFIRMED |
| DEC-007 | Next.js, React, TypeScript and Tailwind frontend | CONFIRMED |
| DEC-008 | Stellar Wallets Kit and `@stellar/stellar-sdk` for wallet/network integration | CONFIRMED direction; APIs/versions to verify |
| DEC-009 | Supabase for supporting app data | CONFIRMED |
| DEC-010 | Vercel for app hosting/server functions | CONFIRMED |
| DEC-011 | Gemini API called server-side | CONFIRMED |
| DEC-012 | Mobile-first conversational interface with collapsible navigation | CONFIRMED |
| DEC-013 | UI reference images supplied by user govern visual direction | CONFIRMED |
| DEC-014 | Prototype uses Stellar testnet and test assets only | CONFIRMED |

## Open decisions / verification tasks

| ID | Question | Default handling |
|---|---|---|
| OPEN-001 | What test asset/token contract will be used? | Verify available testnet asset; do not assume USDC exists on testnet |
| OPEN-002 | How will users authenticate? | Compare wallet signature auth with Supabase Auth; recommend simplest secure approach and explain trade-offs |
| OPEN-003 | Are multi-approver rules in the first contract release? | Include only if contract complexity and tests remain manageable; otherwise defer |
| OPEN-004 | Are milestone tranches in MVP? | Keep optional; defer if they threaten core lifecycle reliability |
| OPEN-005 | What are the exact visual tokens and logo? | Extract from uploaded reference images; ask only if images do not establish them |
| OPEN-006 | What are the contract admin/upgrade controls? | Propose least-privilege approach and document before implementation |
| OPEN-007 | What evidence storage is required? | Store links/metadata initially; add Supabase Storage only if actual upload is in scope |

## Change control

Do not silently alter approved decisions. If new evidence shows a decision is infeasible or unsafe, explain the evidence, propose the smallest necessary change and wait for approval where the change is consequential.