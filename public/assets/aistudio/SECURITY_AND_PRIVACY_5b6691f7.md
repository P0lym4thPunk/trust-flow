# Security and Privacy Requirements

## Threat model

Consider:

- Prompt injection and model manipulation.
- Cross-user data access.
- Forged wallet identity.
- Unauthorized agreement acceptance.
- Unauthorized funding/release/refund.
- Duplicate transaction submission.
- Malformed AI output.
- Malicious agreement content and evidence links.
- Exposed API/database secrets.
- RPC/network errors or stale chain state.
- Supabase RLS misconfiguration.
- Frontend status spoofing.
- Dependency vulnerabilities.

## Controls

### Identity and authorization

- Authenticate every protected server request.
- Verify wallet ownership using a secure challenge/signature flow if wallet auth is used.
- Enforce participant roles server-side.
- Use least privilege.
- Do not rely on hidden UI controls as authorization.

### AI security

- System instructions define the assistant's role but are not a security boundary.
- Treat all user content and retrieved data as untrusted.
- No model access to signing keys or transaction execution tools.
- No direct AI writes to contract state.
- Strict JSON schema validation plus deterministic business-rule validation.
- Data minimisation and user-scoped retrieval.
- Rate limits, request-size limits and output limits.
- Prompt-injection regression tests.

### Wallet and blockchain

- Never collect seed phrases or private keys.
- User signs with their wallet.
- Clearly show network, asset, amount, recipient/contract and action before signature.
- Verify transaction inclusion and contract state after submission.
- Prevent double release and duplicate approvals in the contract.
- Handle timeout as unknown/pending until checked; never assume failure or success from a timeout alone.
- Use testnet and test assets only.

### Database

- RLS on every user-scoped table.
- Server-only service role.
- Validate all data at API boundaries.
- Keep agreement versions and acceptance history.
- Avoid storing unnecessary personal or sensitive information.
- Never store private keys or seed phrases.

### Secrets

- Use Vercel environment variables or the platform's secret manager.
- Use Supabase project URL and public anon key only where appropriate; service role stays server-side.
- Gemini API key server-side only.
- No secrets in Git, client bundles, logs or screenshots.
- Provide `.env.example` with placeholder names only.

### Privacy

- Explain what data is stored and why.
- Minimise AI context to the current task and authorised records.
- Avoid sending unnecessary personal information to Gemini.
- Provide a path to remove optional evidence references where appropriate.
- Define retention expectations before production.

## Security acceptance criteria

- Unauthorized user cannot read another participant's private agreement.
- A user cannot claim another wallet address without valid proof.
- AI cannot trigger a wallet or contract transaction.
- Client-side status manipulation cannot mark an escrow funded/released.
- Invalid AI output is rejected.
- Service-role and Gemini secrets do not appear in browser assets.
- Unauthorized contract actions fail in contract tests.
- Duplicate release and duplicate approvals are rejected.