# evidence-validation

An independent evidence-review service for Astra Lab and other applications. This directory is a standalone repository candidate; the existing Astra application is unchanged.

## What works in this release

- Welcome page, responsive network workspace, explicitly labeled sample tasks.
- PocketBase email/password registration, login, email verification request, reset request, HttpOnly session cookie, logout.
- Durable private review drafts, operator-opened public pilot tasks, independent review submission, owner-visible reviews, one review per reviewer/task.
- Restricted, hashed API credentials with permission scopes, expiry (maximum 90 days), revocation, account record isolation.
- REST API and stateless Streamable HTTP MCP share the same authorization and input validation.
- Deterministic JSON bundle export and SHA-256 digest (not an IPFS CID or a cryptographic signature).
- Proposed USD fee split in integer cents, with the fee recorded on each task. Default Astra-Via fee: 10%.
- Container for Google Cloud Run and a pinned-action, checked-image GitHub deployment workflow.

## Run

Node 22 or newer:

```sh
npm ci
cp .env.example .env
node --env-file=.env src/server.js
```

Open http://localhost:3200. Without PocketBase configuration, sample exploration works but real login and writes are unavailable. Start the adjacent identity project for real persistence. Set APP_ORIGIN to the exact browser origin, including port. Do not use production accounts for local tests.

Configure PocketBase SMTP and verification/reset templates. The default PocketBase auth email links use its built-in confirmation pages. New users must verify their email before creating tasks, reviews, or integration keys.

API-key management additionally requires server-only PocketBase superuser credentials. The service uses them for credential lookup and short-lived user impersonation; business operations still execute under the user's PocketBase record rules. Treat the application server as a trusted security boundary and keep credentials in Secret Manager. A dedicated PocketBase instance limits the impact of those privileges.

## API

Authenticated endpoints accept a PocketBase user token or scoped API key via `Authorization: Bearer ...`. Browser sessions use an HttpOnly cookie.

| Endpoint | Permission | Behavior |
|---|---|---|
| GET /api/v1/jobs | jobs:read | First 50 accessible drafts/open public tasks |
| POST /api/v1/jobs | jobs:write | Create an unfunded draft |
| POST /api/v1/jobs/:id/reviews | reviews:write | Submit one independent review on an open public pilot task |
| GET /api/v1/jobs/:id/bundle | bundles:read | Export task and up to 100 reviews accessible to this account |

A bundle reflects the authenticated account's access; it is not necessarily the full global review history. Reviewers cannot see other reviewers' submissions. Only the task owner can see all task reviews.

Use `/api/keys` in a signed-in account to create, list, or revoke credentials. API credentials cannot create other credentials. No CORS is enabled; server-to-server integrations may omit Origin. Browser requests must use APP_ORIGIN. Base rate limits are process-local; configure an ingress-level limit before multi-instance public deployment.

See `openapi.json` for language-independent request contracts. Credentials do not confer unique-human identity, validator qualification, or financial spending authority.

## MCP

POST `/mcp`, authenticated with an API key. Client must support Streamable HTTP with custom Authorization headers. Hosted OAuth discovery and automatic MCP connector login are not implemented.

Tools: `list_review_tasks`, `create_review_task`, `submit_evidence_review`, `export_evidence_bundle`. Use the same scopes as REST. Requests must accept both `application/json` and `text/event-stream` per the MCP transport. The service is stateless; no persistent MCP session is required.

## Important boundaries

This is a working pilot foundation, not a launched payment network. There is no payment provider, escrow, withdrawal, signed EAS attestation, IPFS/Sia upload, replicated storage, fraud-resistant person registration, qualification review, independent assignment, dispute adjudication, or cryptographic process-key registry yet. No balances or rewards are simulated as real money. Budgets are quotes. Operators may manually open public tasks for **unpaid pilot review** in PocketBase; this does not mark them funded.

Source URLs are stored as references and are not fetched. Uploaded frozen source snapshots and access-granted private reviewer assignments require the next storage/assignment slice. Private drafts are not exposed to other users. Do not publish sensitive evidence into public pilot tasks.

Fee changes require coordinated server configuration and PocketBase create-rule migration. Existing task quotes retain their original fee. Settlement must later recheck an accepted task version and use provider idempotency keys; the current calculator does not transfer money.

## Checks and deployment

`npm run check` runs syntax checks and contract tests. `test/integration.test.js` additionally runs if EV_TEST_POCKETBASE_URL points to an isolated identity instance and the documented test superuser variables are present. Never target production.

See `ARCHITECTURE.md` for repository boundaries and `DEPLOYMENT.md` for Google prerequisites. Google federation, persistent identity hosting, pinned secret versions, and load-balancer ingress are configured; checked main-branch deployments are enabled. The workflow additionally tests the pinned identity schema and real MCP transport before image deployment. Google hosting, hostname routing, and certificate requests are provisioned. New-domain DNS and certificate activation remain pending; see DEPLOYMENT.md.
