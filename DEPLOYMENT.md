# Google deployment

Application: `evidence-validation` in project `astra-via`, region `me-west1`, hosted on Cloud Run. Domain: `evidence-validation.astra-via.com`. Authentication and data use Astra Lab's existing Supabase project `bqwnljcztahgorhqhabp`.

## Existing Supabase setup

1. Apply `supabase/migrations/202610040001_evidence_validation.sql` to the existing project once. Then apply `supabase/migrations/202610110001_evidence_access_required.sql` to require current Evidence approval in every evidence RLS policy. These migrations preserve existing Lab users, other systems, and approval values.
2. Add `https://evidence-validation.astra-via.com` to the existing project's Auth redirect allowlist for verification/recovery emails. Retain existing redirect URLs and email-provider settings.
3. Reuse `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and existing Secret Manager secret `astra-supabase-service-role`, numeric version 1. Only the Cloud Run runtime identity can read this secret. Do not create another auth service.

## GitHub pipeline

Repository variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ARTIFACT_REPOSITORY`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_RUNTIME_SERVICE_ACCOUNT`, `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ADMIN_SECRET_VERSION`, and `DEPLOY_ENABLED=true`.

The workflow audits/tests source, builds once, smoke-tests the image, and deploys that exact image using repository-scoped Workload Identity Federation. Actions and numeric secret versions are pinned. Cloud Run ingress is restricted to internal traffic and the HTTPS load balancer, with max instances 1. The existing Astra invoker-IAM-disabled configuration is retained; Supabase sessions and scoped credentials authorize application requests.

`/healthz` tests the process, not database readiness. The public configuration endpoint reports Supabase configuration without exposing credentials. Production requires an HTTPS APP_ORIGIN and Supabase configuration. Rate limits are process-local; ingress-level limits are needed before scaling horizontally.

## HTTPS

The existing `astra-website-lb` routes `evidence-validation.astra-via.com` to `evidence-validation-backend`/`evidence-validation-neg`. Google-managed certificate `evidence-validation-cert` covers this hostname. Its DNS A record must point to `34.49.17.123` before issuance finishes. Existing Lab and website routes/certificates are preserved.

## Removed identity deployment

The redundant identity VM/disk, instance group, backend, health check, firewall rules, backups, certificate, hostname route, deployment/runtime accounts, federation provider, and identity secrets are removed. The identity workflow is disabled and its repository retired. No `identity.astra-via.com` DNS record is required.

Payments and distributed storage remain unconnected. Deployment does not enable funded tasks or payouts.
