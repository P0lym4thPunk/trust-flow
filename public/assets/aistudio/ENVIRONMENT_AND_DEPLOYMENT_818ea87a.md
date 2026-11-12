# Environment and Deployment

## Environments

Maintain separate local/development and preview/testnet configuration. Production deployment must remain testnet-only until a separate security, legal, operational and product review is completed.

## Environment variable names

Create `.env.example` containing names and safe placeholders only. Exact variables may change with the selected SDKs.

Expected categories:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `GEMINI_API_KEY` (server-only)
- `STELLAR_NETWORK` (explicit testnet value for prototype)
- `STELLAR_RPC_URL`
- `STELLAR_HORIZON_URL` if required by the chosen integration
- `ESCROW_CONTRACT_ID`
- `TEST_ASSET_CONTRACT_ID`
- Any wallet/auth callback configuration required by verified packages.

Do not put secrets in `NEXT_PUBLIC_*` variables. Do not commit `.env.local`.

## Google AI Studio

Google AI Studio Build Mode can generate a React frontend with a Node.js server runtime, install npm packages, manage server-side secrets, import/sync GitHub repositories and export source. Verify the current Build Mode documentation and account capabilities before relying on a specific workflow.

For this project:

- Use AI Studio as the application-generation and iteration environment.
- Keep Gemini calls server-side.
- Add third-party credentials through the platform's Secrets interface during development.
- Do not assume AI Studio's runtime is the final deployment environment.
- Keep the code compatible with the intended Vercel deployment and verify runtime differences.
- Sync to GitHub early and frequently.

## Vercel

- Import the GitHub repository.
- Configure environment variables per environment.
- Deploy a preview first.
- Verify server-side routes and secrets.
- Verify Supabase connectivity and RLS.
- Verify Stellar testnet RPC and contract interaction.
- Run smoke tests after deployment.

## Supabase

- Apply migrations in a controlled order.
- Enable RLS on user-scoped tables.
- Test policies using different users/participants.
- Keep service-role key server-side.
- Back up schema/migration files in source control.

## Stellar

- Use testnet only.
- Verify the network passphrase and RPC endpoints from official Stellar docs.
- Verify token contract ID and asset precision.
- Use test accounts and test assets.
- Store deployed contract ID and deployment transaction reference in project configuration.
- Do not include private test account secrets in source control.

## Handover checklist

- Repository URL and branch.
- Framework/package versions.
- Environment variable names (not values).
- Supabase project/schema information.
- Stellar network and contract ID.
- Wallets used for test.
- Test commands and results.
- Known issues and limitations.
- Deployment URL and smoke-test result.