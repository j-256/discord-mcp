# Documentation portal operations

This guide owns the infrastructure lifecycle for the canonical documentation origin at `https://docs.guildcontrol.lasers.app` and the temporary product-host redirect at `https://guildcontrol.lasers.app`. The release runbook owns version publication and treats a healthy, exact documentation deployment as a precondition. It does not duplicate hosting setup here.

## Deployment contract

GuildControl publishes an assets-only Cloudflare Worker from `site/wrangler.jsonc`. The canonical site is a deterministic Astro build with no runtime origin, server function, secret, or Discord access. The stable `guildcontrol-docs.etzios.workers.dev` route remains available for bootstrap and provider-level diagnosis, while per-version preview URLs are disabled and canonical metadata remains bound to `docs.guildcontrol.lasers.app`. The tracked Worker configuration also disables Wrangler telemetry for this project.

Until a product is deployed, `guildcontrol.lasers.app` is the reserved product origin and returns an HTTP 307 redirect to the documentation origin. The zone-level rule uses stable ref `guildcontrol_product_to_docs` and preserves the complete path and query string. Its proxied `AAAA 100::` record is an originless placeholder that lets the redirect rule receive traffic; it is not an application origin. The exact-name MCP verification `TXT` record is independent and must remain intact. Do not add shorthand product or documentation aliases without a separate review.

The CI workflow separates verification from authority:

1. The `Documentation portal` job installs locked dependencies, generates the site from the checked-out source, runs static, unit, browser, accessibility, and link checks, dry-runs the Worker deployment, and uploads `site/dist` as the generic `documentation-portal` artifact.
2. The `CI gate` requires the documentation job and every other release-quality job to pass.
3. The `Publish documentation portal` job runs only for protected `main` pushes or an explicit `deploy-documentation` dispatch at `main`. It downloads the verified artifact from the same workflow run, receives the deployment credential only from the protected `documentation` environment, uploads those exact files, and checks the public manifest over HTTPS.

Pull requests, scheduled checks, build steps, browser tests, and artifact uploads never receive a Cloudflare credential. CI has no DNS, custom-domain, certificate, or redirect-rule authority.

## Cloudflare and GitHub setup

Use [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) for the site and keep the Worker name `guildcontrol-docs`.

1. Create a GitHub Actions environment named `documentation` and restrict its deployment branches to protected `main`. A required reviewer is unnecessary for this public static site because the protected branch and complete CI gate already define the reviewed content boundary.
2. Set the environment variable `CLOUDFLARE_ACCOUNT_ID` to the deployment account identifier. This identifier is routing metadata, not a credential.
3. Create a dedicated account-owned Cloudflare API token named `j-256/guildcontrol Worker deploy token`. Limit its account resource to the deployment account and grant only Workers Scripts Write.
4. Capture the returned-once token directly into the maintainer password manager and the environment secret `CLOUDFLARE_WORKERS_DEPLOY_TOKEN`. Never print it, place it in shell history, write it to a repository or temporary file, or reuse a broader operator token.
5. Build and dry-run the exact site before the first upload:

```sh
npm run deps:locked
npm run build
npm --prefix site run deps:locked
npm --prefix site run browser:install
npm --prefix site run verify
npm --prefix site run deploy:dry-run
```

6. Bootstrap the Worker with the dedicated token available only in the process environment, then discard the process-local value. The tracked deployment command is `npm --prefix site run deploy`; do not add an alternate dashboard build configuration.
7. Attach only `docs.guildcontrol.lasers.app` to the `guildcontrol-docs` Worker as a Custom Domain. Keep `workers_dev` enabled and preview URLs disabled.
8. Set the GitHub repository homepage to `https://docs.guildcontrol.lasers.app`.

The Workers Scripts Write token can upload Worker code and assets. It cannot edit DNS, attach a custom domain, manage certificates, or change redirect rules. Keep those authorities with a maintainer credential used only during deliberate infrastructure operations.

## Documentation-host cutover

Use purpose-built Cloudflare inventory and reviewed mutation paths. Preserve all unrelated `lasers.app` DNS records and redirect rules throughout the cutover.

1. Inventory the exact Worker custom domains, every DNS record at both GuildControl hostnames, the relevant certificate packs, the complete `http_request_dynamic_redirect` ruleset, the GitHub homepage, and the live canonical metadata.
2. Attach `docs.guildcontrol.lasers.app` to the existing `guildcontrol-docs` Worker without detaching the product hostname. Require the new binding to be enabled, require its certificate pack and leaf certificates to be active, and require a successful HTTPS response before continuing.
3. Push the source migration through the normal protected pull-request path. Require every status check, merge to protected `main`, and require `Publish documentation portal` to deploy and verify the exact workflow artifact at the new documentation origin.
4. Independently retain the local `site/dist/generated/docs-manifest.json` and verify the canonical deployment:

```sh
node scripts/check-public-documentation.mjs \
  --manifest site/dist/generated/docs-manifest.json \
  --attempts 6 \
  --delay-ms 10000
```

5. Only after the exact canonical verification passes, add the enabled zone-level redirect rule with stable ref `guildcontrol_product_to_docs`. Match only `guildcontrol.lasers.app`, return HTTP 307, build the target from `https://docs.guildcontrol.lasers.app` plus `http.request.uri.path`, and preserve the query string.
6. Verify representative root, nested, encoded-path, and multi-value query requests before changing the old Worker binding.
7. Detach only the `guildcontrol.lasers.app` Worker custom domain. Confirm its Cloudflare-managed read-only DNS record is gone, then create one proxied originless `AAAA 100::` record at that exact name. Preserve the MCP verification `TXT` record and every unrelated record.
8. Recheck the complete custom-domain, DNS, certificate, and redirect-rule inventories. Require the canonical host to return exact Worker bytes, the product host to return exactly HTTP 307 with its path and query string preserved, and the stable workers.dev route to remain available.

Keep the old Worker serving path available until the new custom domain has active TLS and the protected-main canonical deployment passes the exact artifact verifier. Do not detach the old binding merely because DNS or a certificate request is pending.

## Rollback

Before detaching the old Worker custom domain, disable or remove only the `guildcontrol_product_to_docs` rule and continue serving both custom domains while the source or deployment issue is corrected.

After detachment, first remove only the originless product-host `AAAA` placeholder. Reattach `guildcontrol.lasers.app` to the `guildcontrol-docs` Worker, require Cloudflare-managed DNS and active TLS, verify the old origin against the retained artifact, and then disable or remove only the product redirect rule. Preserve the exact-name MCP verification `TXT` record throughout. Revert a source regression through the protected pull-request path rather than editing Worker assets in the dashboard.

## Routine deployment and recovery

A protected `main` push deploys automatically after the full CI gate. An explicit `deploy-documentation` workflow dispatch at `main` provides a credential-rotation or same-commit recovery path without changing source. The default `verify` dispatch runs the high-cost external evidence checks without deploying. No path rebuilds inside the privileged job.

For a content or configuration regression, revert the responsible commit through the normal protected pull-request path. Avoid dashboard edits because they create unreviewed state that the source manifest cannot explain. For a suspected credential leak, revoke the token first, create a replacement with the same narrow policy, update the password-manager entry and environment secret, and dispatch the workflow at `main` to prove the replacement.

The public verifier compares the deployed documentation manifest and every declared output with the verified local artifact. It proves exact publication of those bytes at the canonical origin. It does not prove that Cloudflare, DNS, GitHub, dependencies, or the documented product behavior are free of vulnerabilities.
