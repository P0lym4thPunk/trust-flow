
### 14. `technical/DATABASE_AND_API_SPEC.md`

```markdown
# Database and API Specification

## Data ownership

Supabase stores application data and user-facing projections. Soroban and Stellar remain authoritative for escrow funds and contract state.

Use Supabase Row Level Security (RLS) for user-scoped records. Service-role credentials must remain server-side.

## Proposed tables

### `profiles`

- `id` — auth identity UUID.
- `display_name`
- `avatar_url` (optional)
- `created_at`
- `updated_at`

Wallet addresses may be stored in a separate wallet table if users can connect multiple wallets.

### `wallets`

- `id`
- `user_id`
- `public_key`
- `network`
- `is_verified`
- `created_at`

Never store private keys or seed phrases.

### `agreements`

- `id` — application UUID.
- `created_by`
- `transaction_type`
- `title`
- `description`
- `terms_json`
- `agreement_hash`
- `version`
- `status_projection`
- `contract_id` / escrow identifier when available.
- `network`
- `created_at`
- `updated_at`

### `agreement_participants`

- `id`
- `agreement_id`
- `user_id` nullable if invitee has not registered.
- `wallet_address`
- `role`
- `acceptance_status`
- `accepted_version`
- `accepted_at`

### `evidence_references`

- `id`
- `agreement_id`
- `submitted_by`
- `reference_type`
- `reference_url` or storage key
- `description`
- `created_at`

### `chain_transactions`

- `id`
- `agreement_id`
- `network`
- `transaction_hash`
- `operation_type`
- `verification_status`
- `ledger_sequence` if available
- `created_at`
- `verified_at`

### `activity_events`

- `id`
- `agreement_id`
- `actor_wallet`
- `event_type`
- `description`
- `source` (`APP` or `CHAIN`)
- `chain_transaction_id` nullable
- `created_at`

### `ai_request_audit`

Store minimal operational metadata only:

- request ID
- authenticated user ID
- prompt version
- model identifier
- task type
- validation result
- latency
- created_at

Do not store full private prompts or sensitive agreement content by default.

## API route concepts

Exact route design may adapt to Next.js conventions, but preserve responsibilities.

### `POST /api/ai/agreement-draft`

- Authenticates user.
- Accepts user intent and selected transaction type.
- Calls Gemini server-side.
- Validates structured output.
- Returns draft or clarification.

### `POST /api/ai/agreement-check`

- Authenticates user.
- Validates submitted draft.
- Runs AI check and deterministic rules.
- Returns structured findings.

### `POST /api/agreements`

- Validates user and agreement.
- Saves a draft.
- Does not fund or create on-chain escrow by itself.

### `GET /api/agreements`

- Returns only agreements the authenticated user is authorised to view.

### `GET /api/agreements/:id`

- Enforces participant/role access.

### `POST /api/agreements/:id/accept`

- Records acceptance of the exact version, with appropriate identity proof.

### `POST /api/agreements/:id/chain-sync`

- Server-side verification/indexing only. Must not trust client claims that a transaction succeeded.

Do not expose a server endpoint that lets the AI approve, release or refund funds.

## Authentication decision

Evaluate wallet-signature authentication versus Supabase Auth.

If wallet ownership is used, implement a secure nonce/challenge, signature verification, expiry, replay protection and session handling based on current Stellar signing capabilities.

Never ask for a secret key. Do not trust a wallet address supplied in a request without proof of ownership.

## RLS and access

- Users can read their own profiles and authorised agreement records.
- Participants can read only agreements to which they are attached.
- Only permitted roles can update relevant off-chain fields.
- Client cannot set chain verification state.
- AI endpoints use authenticated server context and fetch only authorised records.
- Service role is never exposed to browser.

Generate migrations and test RLS policies. Document any public agreement-link access and use unguessable, revocable invitation tokens if implemented.