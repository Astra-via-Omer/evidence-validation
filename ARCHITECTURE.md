# Architecture

Astra Lab defines reusable claim/evidence/gravity models and investigation paths. Evidence Validation coordinates independent evidence reviews for Lab and other clients. Both use the **existing Astra Supabase project and user accounts**.

| Component | Hosting | Responsibility |
|---|---|---|
| evidence-validation | Cloud Run, evidence-validation.astra-via.com | Welcome/UI, session handling, scoped REST API, MCP, reviews, exports, fee quotes |
| Existing Astra Supabase | Existing project | Shared authentication and evidence tables with row-level security |

No separate identity service or second authentication system is needed. The former evidence-validation-identity deployment is removed and its repository retired.

Supabase session JWTs are verified with `auth.getUser` before use. Existing disabled/banned account settings are honored. User database calls use the public key plus verified JWT and RLS. Integration keys are SHA-256 hashes with restricted scopes and expiry. The trusted server looks them up with the existing server-only Supabase key, checks the owner's current account state, and applies explicit owner predicates to every data operation. Hashes and the service key never reach the browser.

The migration references `auth.users`; it creates `ev_jobs`, `ev_reviews`, and `ev_api_keys`. Drafts and submitted reviews are immutable for users. Public drafts stay private until an operator opens them. Reviews stay blind to other reviewers. Key issuance/revocation is server-managed. No existing Lab table is modified.

Future storage and settlement adapters can be independent services when implemented. HTTP/JSON and MCP contracts do not require those adapters to use JavaScript. Distributed storage, attestations, payments, and unique-human qualification are future work.

Investigation boards and lawyer meeting preparation share an owner-only `ev_cases` document. Source cards reference existing `ev_jobs`; saving rechecks each referenced task's current visibility. Case creation and revision-checked updates require a verified browser session and current Evidence approval. Both explicit owner filters and RLS protect reads/updates, and the revision predicate prevents stale concurrent saves. Integration keys and MCP cannot read case annotations or meeting notes. Public IPFS snapshots continue to use only the existing evidence-job/review bundle schema; private cases are never included. Rewards retain their existing integer-cent fee calculations and unconnected settlement state.
