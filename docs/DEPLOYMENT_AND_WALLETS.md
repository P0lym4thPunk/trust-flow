# TrustFlow Deployment, Single-Process Persistence & Wallet Compatibility Guide

This document records TrustFlow's Phase 2 operational constraints, SEP-53 domain configuration requirements, and verified Stellar external wallet capabilities.

---

## 1. JSON Persistence & Single-Process Deployment Constraints

TrustFlow persists users, sessions, SEP-53 wallet challenges, provisioning state, and agreements to disk as JSON files inside `DATA_DIR` (default: `<cwd>/.data`). This is **persistent filesystem storage**, not an in-memory-only store.

### Mandatory Operational Rules

1. **Single Node.js Process Only**: TrustFlow currently supports running **one Node.js process / worker / instance** against its JSON persistence layer.
2. **Persistent Volume Required**: The deployment environment must mount and preserve a persistent filesystem or volume for `DATA_DIR`. Ephemeral container storage will lose user records, linked wallets, sessions, and agreements on container replacement.
3. **No Multiple Replicas or Cluster Workers**: Do **not** run multiple application replicas, autoscaled pods, or Node `cluster` workers against the same `DATA_DIR` JSON files. Concurrent multi-process writes can overwrite updates or corrupt state.
4. **Process-Local Locks Only**: `KeyedOperationLock` (`backend/src/repositories/operationLock.ts`) and `JsonFileStore` promise queues provide serialization **only within a single Node.js process**. They do **not** provide cross-process or distributed coordination.
5. **Restart Guarantees & Boundaries**: Application restarts are safe only to the extent that the hosting platform preserves `DATA_DIR` across restarts and the existing atomic temp-file write + rename (`writeFileSync` + `renameSync`) completes or leaves the prior committed file intact.
6. **Future Multi-Instance Migration**: Scaling horizontally across multiple containers or replicas requires a future persistence and concurrency migration to a transactional shared database (e.g., PostgreSQL) and suitable distributed coordination.
7. **Out of Current Scope**: That database migration is intentionally not part of Phase 2.

---

## 2. SEP-53 Canonical Origin & Environment Configuration

External Stellar wallet linking uses human-readable SEP-53 ownership messages bound to a server-controlled canonical domain. Incoming `Host` and `X-Forwarded-Host` headers are never trusted or interpolated.

| Variable | Purpose | Production Requirement |
| --- | --- | --- |
| `APP_ORIGIN` | Canonical `https://` (or local `http://`) origin whose hostname + port forms the SEP-53 challenge domain | **Required in production** (`NODE_ENV=production`). Missing or invalid origins fail closed (`500`). |
| `TRUSTED_ORIGINS` | Optional comma-separated list of additional trusted origins validated at startup | Strictly parsed via URL validation; invalid entries fail configuration checks. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional Reown/WalletConnect project ID enabling QR/mobile WalletConnect pairing in `WalletPickerModal` | Disabled cleanly in UI with explicit setup message if unset. |
| `VITE_PRIVY_WALLET_TEST_MODE` | Dev-only signing harness guard (`DevPrivySigningTestPanel`) | Build-time stripped from production `dist/assets/` via Vite build plugin; never exposed in production. |

---

## 3. External Stellar Wallet Capability Matrix

**Integration Approach:** `@creit.tech/stellar-wallets-kit@2.8.0` wrapped by `src/lib/stellar/walletsKit.ts` and `src/components/WalletPickerModal.tsx`.

> **Verification Status Note:** Capability columns below are verified by inspecting the installed `@creit.tech/stellar-wallets-kit@2.8.0` TypeScript declarations and compiled ESM modules plus mocked/unit adapter tests. **Live browser extension and mobile wallet end-to-end verification remains unexecuted in this environment** and requires manual testing with real installed wallets.

| Provider / Module ID | Connect | Address Retrieval (`getAddress`) | SEP-53 Sign Message (`signMessage`) | Network Query (`getNetwork`) | Tx Signing (`signTransaction`, future Phase 3) | Verification Status & Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| **Freighter / Varial** (`varial`) | Yes | Yes | Yes | Yes | Yes | SDK + unit tested (`VarialModule`). Legacy `freighter` provider records formatted cleanly. Live extension prompt not run in automated CI. |
| **xBull** (`xbull`) | Yes | Yes | Yes | No (`-3`) | Yes | SDK + unit tested (`xBullModule`). `getNetwork()` rejects `-3`; SEP-53 `signMessage` supported in SDK. Live extension test pending. |
| **LOBSTR** (`lobstr`) | Yes | Yes | Yes (caveat) | No (`-3`) | Yes | SDK + unit tested (`LobstrModule`). **Caveat:** `signMessage` in SWK v2.8.0 ignores `address`/`networkPassphrase` opts and signs using the active LOBSTR extension account. Live test pending. |
| **Hana** (`hana`) | Yes | Yes | Yes | No (`-3`) | Yes | SDK + unit tested (`HanaModule`). `getNetwork()` rejects `-3`. Live extension test pending. |
| **Scopuly** (`scopuly`) | Yes | Yes | Yes | Yes | Yes | SDK + unit tested (`ScopulyModule`). Live extension test pending. |
| **Klever** (`klever`) | Yes | Yes | Yes | Yes | Yes | SDK + unit tested (`KleverModule`). Live extension test pending. |
| **WalletConnect** (`wallet_connect`) | Conditional | Conditional | Conditional (`stellar_signMessage`) | No (`-3`) | Conditional | Requires `VITE_WALLETCONNECT_PROJECT_ID`; disabled with honest message when unset. Depends on mobile wallet supporting `stellar_signMessage`. Live mobile pairing test pending. |
| **Albedo** (`albedo`) | Yes | Yes | **No (`-3`)** | Yes | Yes | **Blocked by SDK capability:** SWK `AlbedoModule.signMessage` throws `-3` (not SEP-0043/SEP-53 compatible). Disabled for ownership verification in TrustFlow UI. |
| **Rabet** (`rabet`) | Yes | Yes | **No (`-3`)** | Yes | Yes | **Blocked by SDK capability:** SWK `RabetModule.signMessage` throws `-3`. Disabled for ownership verification in TrustFlow UI. |
| **Hardware / Other** (`ledger`, `trezor`, etc.) | Untested | Untested | Undocumented / varies | Varies | Hardware-dependent | Not enabled in Phase 2 `WalletPickerModal` catalog; firmware message-signing compatibility unverified. |

---

## 4. Product Scope & Security Boundaries (Phase 2)

- Escrow execution routes (`/api/escrow/*`, fund/release/refund) remain disabled (`501`).
- No live Stellar transactions or Soroban smart contracts are deployed or broadcast in Phase 2.
- All external wallet linking requires server-issued single-use SEP-53 challenges verified Ed25519 cryptographically under serialized `user` + `wallet` locking; failed uniqueness checks do not consume valid challenges.
