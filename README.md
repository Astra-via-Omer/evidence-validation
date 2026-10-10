# evidence-validation

An independent evidence-review service for Astra Lab and other applications. **Authentication uses the same Supabase project and accounts as Astra Lab.** There is one application repository and no separate identity deployment.

## Run

Node 22 or newer:

```sh
npm ci
cp .env.example .env
node --env-file=.env src/server.js
```

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Astra Lab's existing project configuration. Set the existing server-only `SUPABASE_SERVICE_ROLE_KEY` to enable scoped integration credentials. Never put the service key in browser code or GitHub. The public welcome page and workflow guide remain available; working in the project always requires authentication and Evidence approval.

Apply `supabase/migrations/202610040001_evidence_validation.sql` and `supabase/migrations/202610110001_evidence_access_required.sql` to the **existing** Supabase project using its SQL editor or migration tooling. It creates only evidence tables, policies, and a verification helper; it references the existing `auth.users`. It does not replace existing users or alter Lab tables. Add the Evidence Validation origin to the existing Supabase Auth redirect allowlist for confirmation and recovery emails. Do not create another Supabase project or authentication server.

## Access approval

In the existing Supabase Table Editor, open `public.astra_user_system_access` and enable the `evidence` boolean only for an approved account. Its existing trigger mirrors this into protected `app_metadata.system_access.evidence`. Missing approval is denied; user-editable metadata cannot grant access. The account must also have a verified email and must not be disabled, banned, deleted, or anonymous. Revocation blocks existing sessions and API credentials on their next request, and RLS checks current approval for direct database requests.

No existing approval is added or removed by the Evidence migration. Administrators manage new accounts using the existing Astra account process.

## Pilot features

- Public welcome page and responsive, authenticated workspace. Public sample mode and self-registration are disabled.
- Public `/how-it-works` guide with an interactive eight-step claim-to-ledger flow, also available on the welcome page and in workspace navigation. Planned Web3 stages are explicitly labeled.
- Shared Astra email/password accounts, confirmation/recovery through existing Supabase Auth, HttpOnly access/refresh cookies, and current per-user Evidence approval checks on login, email-link exchange, refresh, browser/API requests, and MCP.
- Private immutable drafts, operator-opened public unpaid tasks, one independent review per account/task, and blind reviews visible to their author and task owner.
- Hashed, scoped API credentials with expiry up to 90 days and revocation. API credentials cannot manage credentials.
- Restricted REST API and stateless Streamable HTTP MCP using the same permissions.
- Deterministic JSON bundles with SHA-256 digests, and proposed integer-cent fee splits (default Astra-Via fee: 10%).

## API and MCP

Accepts `Authorization: Bearer <existing Supabase access token or evk_ credential>`. Browser requests use HttpOnly cookies and must come from `APP_ORIGIN`.

| Endpoint | Scope |
|---|---|
| GET /api/v1/jobs | jobs:read |
| POST /api/v1/jobs | jobs:write |
| POST /api/v1/jobs/:id/reviews | reviews:write |
| GET /api/v1/jobs/:id/bundle | bundles:read |

`/api/keys` lets signed-in accounts create/list/revoke their own integration credentials. Only secret hashes are stored; browser-facing key lists exclude them. Supabase RLS protects browser-session operations. Server-side API-key operations enforce explicit owner/public-task predicates because the existing service key bypasses RLS.

POST `/mcp` uses Streamable HTTP and supports `list_review_tasks`, `create_review_task`, `submit_evidence_review`, and `export_evidence_bundle`. Clients must supply custom Authorization headers and accept both application/json and text/event-stream. Hosted OAuth discovery is not implemented. See `openapi.json` for contracts.

## Boundaries

This is an unpaid pilot. Payments, escrow, payouts, qualified assignments, disputes, IPFS/Sia publication, and signed attestations remain unimplemented. Budgets are quotes, not balances. Source URLs are references; the service does not fetch them. Operators can open eligible public drafts for unpaid review in Supabase. Private reviewer assignments are not implemented. Bundle exports contain only the authenticated account's accessible reviews, up to 100.

## Verification and hosting

`npm run check` runs syntax, contract, PostgreSQL RLS isolation, authentication, scoped-API, and MCP tests. SQL tests use an isolated embedded PostgreSQL instance; they never touch production users. `npm audit --omit=dev` checks deployed dependencies.

Google Cloud Run hosts this application using checked images and the existing Google HTTPS load balancer process. See `DEPLOYMENT.md` and `ARCHITECTURE.md`. The redundant identity repository is retired.
