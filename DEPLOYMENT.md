# Google deployment

Target: evidence-validation.astra-via.com. The earlier atra-via spelling is awaiting confirmation; this configuration follows the requested *.astra-via.com convention.

## Core application

Deploy the supplied Dockerfile to Cloud Run. Set APP_ORIGIN to the final HTTPS origin and POCKETBASE_URL to the separately hosted identity service. The container is stateless and runs as a non-root user. `/healthz` checks the process, not the health of PocketBase or external providers.

The check-and-deploy workflow requires repository variables:

- GCP_PROJECT_ID, GCP_REGION, GCP_ARTIFACT_REPOSITORY (pre-created Artifact Registry repository)
- GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_DEPLOY_SERVICE_ACCOUNT
- GCP_RUNTIME_SERVICE_ACCOUNT
- POCKETBASE_URL, APP_ORIGIN (HTTPS origins)
- POCKETBASE_EMAIL_SECRET_VERSION, POCKETBASE_PASSWORD_SECRET_VERSION (numeric versions)
- DEPLOY_ENABLED=true only after cloud prerequisites are verified

Create Secret Manager secrets `ev-pocketbase-superuser-email` and `ev-pocketbase-superuser-password`; give only the runtime service account access. Configure GitHub OIDC/Workload Identity Federation for this repository and environment. Enable Cloud Build, Artifact Registry, Cloud Run, and Secret Manager APIs and appropriate build/deploy/runtime IAM permissions. Do not commit service-account JSON keys.

The workflow audits/tests source, builds one image, smoke-tests it, and transfers that exact checked image between jobs. It runs checks on pull requests and main pushes. Main deployment is enabled only when DEPLOY_ENABLED=true; manual deployment additionally requires the security_reviewed checkbox. It uses pinned action commits, Workload Identity Federation, numeric secret versions, and private Cloud Run ingress, following the Astra Lab pipeline pattern. Deployment jobs are serialized. This workflow is prepared but has not been executed against a Google project.

Reuse the existing Google-managed HTTPS load balancer/certificate process after inspecting it. Configure separate hostname routing and certificate coverage; do not modify the Lab backend route. A certificate covering lab.astra-via.com alone does not automatically cover new hostnames. Keep Cloud Run private and use the established authenticated gateway pattern. For the first public deployment, configure ingress-level throttling and protect PocketBase administrative access. For preview, use the exact HTTPS Cloud Run URL as APP_ORIGIN instead of the custom domain until DNS is ready.

## Identity service

Use Compute Engine with persistent disk (or another durable VM), not an ephemeral Cloud Run filesystem. PocketBase uses SQLite and must retain its pb_data directory. Use one active writer instance, automated encrypted backups, and tested restoration. Configure HTTPS/reverse proxy, SMTP, email confirmation links, and restricted superuser access. See the separate identity README.

## Not deployable yet

Storage networks and payment settlement have no configured providers. Do not enable paid tasks by changing a status field. The current task states intentionally have no paid/funded state. Production NODE_ENV only requires secure origin and identity configuration; it does not assert financial readiness.

## Local verification result

The PocketBase migration, five contract/integration tests, real MCP client calls, and desktop/mobile UI checks passed locally. npm audit reported no known dependency vulnerabilities. Container image builds were not verified because the local Docker daemon was unavailable. Google deployment and DNS have not been run.
