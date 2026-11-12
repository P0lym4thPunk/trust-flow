# System Architecture

## Architecture goals

- Keep the application understandable and modular.
- Keep AI generation separate from payment authority.
- Keep wallet signing on the user's device.
- Keep escrow asset custody and lifecycle rules inside Soroban.
- Use Supabase for supporting records, not as the source of truth for funds.
- Make the app portable between AI Studio development and Vercel deployment.

## Intended stack

### Frontend

- Next.js App Router (verify current supported version).
- React.
- TypeScript with strict mode.
- Tailwind CSS.
- Accessible reusable components.

### Wallet and Stellar

- Stellar Wallets Kit for wallet connection and wallet selection.
- `@stellar/stellar-sdk` for JavaScript Stellar SDK functionality, transaction building, network configuration and Soroban RPC interaction.
- Rust and `soroban-sdk` for the on-chain contract.
- Verify current official SDK documentation and package APIs before implementation.

### Backend

- Next.js server-side route handlers/server modules deployed on Vercel.
- Supabase Postgres for application records.
- Supabase Auth only if selected after evaluating wallet-based identity and security.
- Supabase Storage only if evidence uploads are required.
- Gemini API only from server-side code.

### Hosting

- Vercel for frontend and server-side functions.
- Supabase managed database.
- Stellar testnet for blockchain interaction.

## Suggested repository structure

```text
trustflow/
├── AGENT_INSTRUCTIONS.md
├── MASTER_PROJECT_SPECIFICATION.md
├── PROJECT_STATUS.md
├── DECISIONS.md
├── app/
│   ├── (public)/
│   ├── (app)/
│   └── api/
│       ├── ai/
│       ├── agreements/
│       └── webhooks/
├── components/
│   ├── shell/
│   ├── chat/
│   ├── agreements/
│   ├── transactions/
│   └── ui/
├── features/
│   ├── ai-assistant/
│   ├── agreements/
│   ├── escrow/
│   ├── wallet/
│   └── activity/
├── lib/
│   ├── stellar/
│   ├── supabase/
│   ├── validation/
│   ├── auth/
│   └── config/
├── contracts/
│   └── trustflow-escrow/
├── supabase/
│   ├── migrations/
│   └── seed/
├── public/
│   └── assets/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
└── package.json