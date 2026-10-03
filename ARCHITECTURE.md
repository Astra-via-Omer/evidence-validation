# Platform and repository boundaries

## Create these repositories now

| Repository | Suggested domain | Language | Responsibilities |
|---|---|---|---|
| evidence-validation | evidence-validation.astra-via.com | Node.js backend, JavaScript UI | Welcome, dashboard, authorized REST/MCP, task and review orchestration, fee quotes |
| evidence-validation-identity | identity.astra-via.com | Go (PocketBase runtime), JavaScript migrations | Authentication, email verification, persistent records, record access rules |

The identity hostname should be protected appropriately, especially the superuser dashboard. The public application does not need to expose PocketBase credentials to browsers. Two deployables are enough for this pilot. Each directory is ready to become its own GitHub repository. Nested workflows run after the directory becomes a repository root.

## Extract these only when their integration is implemented

| Future repository | Suggested domain | Suitable language | Contract |
|---|---|---|---|
| evidence-validation-storage | storage.astra-via.com | Go or Rust | Store/retrieve approved snapshots; encrypted private bundles; IPFS/Sia/Filecoin/Arweave adapters; replication receipts |
| evidence-validation-settlement | settlement.astra-via.com | Go or TypeScript; Solidity for EVM escrow | Fund, reserve, settle/refund; provider webhooks; idempotent money ledger; Astra-Via fee allocation |
| evidence-validation-worker | Internal service; worker.astra-via.com only if externally needed | Python or Go | Bounded asynchronous evidence checks and integration jobs; never the final arbiter of truth |

The MCP server stays in the core application because it exposes the same operations and policy as the API. An Astra integration is a client/adapter, not a separate server by default.

## Language-independent protocol

HTTP/JSON + OpenAPI for service requests, Streamable HTTP for MCP, versioned JSON bundles for evidence. Clients can use Python, JavaScript, Go, Rust, Java, C#, or any language with HTTP support. No shared-language requirement and no cross-service database writes.

Future durable events should include eventId, schemaVersion, occurredAt, tenantId/accountId, requestId, actorId, and payload. Consumers must deduplicate by eventId. Money events additionally use operation-specific idempotency keys. This event bus is a design boundary, not implemented infrastructure.

## Account and process separation

Current accounts own drafts and credentials. Every application receives its own key, scopes, and expiry. Shared organization tenants, signing-key registration, qualified validator membership, task assignments, payout wallets, and spend budgets are later extensions. An API key is not a wallet and grants no financial spending authority.

## Economic protocol before real payments

1. Freeze criteria, required reviewers, deadline, reward, currency/asset, fee basis points, refund rules, and network charges at funding.
2. Reserve customer funds through a provider or escrow; record authoritative confirmation.
3. Assign independent qualified reviewers; exclude requester and conflicts; keep submissions blind.
4. Accept evidence-based work under published rules. Escalate disagreement and allow a bounded appeal.
5. Atomically record a settlement intent and use the provider's idempotency mechanism.
6. Allocate the disclosed Astra-Via fee and validator reward. Reconcile provider events and issue receipts.

The platform cannot charge for payments made outside its settlement path. IPFS hashes and blockchain attestations cannot themselves establish truth or independence.

## Pilot storage

PocketBase is the authoritative database for this release. Drafts and reviews are immutable through user APIs. Integration-key creation/revocation is server-managed. Administrative transitions are operator-only. A private task cannot be reviewed by another account yet.

Before public financial launch, implement qualified membership, assignments, disputes, durable snapshots, reconciliation, provider-specific controls, multi-instance rate limiting, key rotation and backups. Deploying the pilot UI does not complete these capabilities.
