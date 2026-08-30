# Documentation portal operations

This guide owns the infrastructure lifecycle for `https://guildcontrol.lasers.app`. The release runbook owns version publication and treats a healthy, exact documentation deployment as a precondition. It does not duplicate hosting setup here.

## Deployment contract

GuildControl publishes an assets-only Cloudflare Worker from `site/wrangler.jsonc`. The canonical site is a deterministic Astro build with no runtime origin, server function, secret, or Discord access. The stable `workers.dev` route remains available for bootstrap and provider-level diagnosis, while per-version preview URLs are disabled and canonical metadata remains bound to `guildcontrol.lasers.app`. The tracked Worker configuration also disables Wrangler telemetry for this project.

The CI workflow separates verification from authority:

1. The `Documentation portal` job installs locked dependencies, generates the site from the checked-out source, runs static, unit, browser, accessibility, and link checks, dry-runs the Worker deployment, and uploads `site/dist` as the generic `documentation-portal` artifact.
2. The `CI gate` requires the documentation job and every other release-quality job to pass.
3. The `Publish documentation portal` job runs only for protected `main` pushes or an explicit `deploy-documentation` dispatch at `main`. It downloads the verified artifact from the same workflow run, receives the deployment credential only from the protected `documentation` environment, uploads those exact files, and checks the public manifest over HTTPS.

Pull requests, scheduled checks, build steps, browser tests, and artifact uploads never receive a Cloudflare credential. CI has no DNS or custom-domain authority.

## One-time Cloudflare and GitHub setup

Use [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) for the site and keep the Worker name `guildcontrol`.

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

The Workers Scripts Write token can upload Worker code and assets. It cannot edit DNS or attach a custom domain. Keep those authorities with a maintainer credential used only during deliberate infrastructure operations.

## Custom-domain cutover

Cloudflare cannot attach a Workers Custom Domain while a conflicting DNS record exists. Follow the official [Pages-to-Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) and [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) procedures in this order:

1. Confirm the Worker upload completed and the exact local `site/dist/generated/docs-manifest.json` is retained for verification.
2. Remove the custom-domain binding from the old GitHub Pages site.
3. Delete only the exact DNS record for `guildcontrol.lasers.app`. Do not change the wildcard `*.j-256.dev` repository redirect or unrelated `lasers.app` records.
4. Attach `guildcontrol.lasers.app` to the `guildcontrol` Worker as a Custom Domain. Let Cloudflare create and manage its DNS record and certificate.
5. Require a valid HTTPS response and run:

```sh
node scripts/check-public-documentation.mjs \
  --manifest site/dist/generated/docs-manifest.json \
  --attempts 6 \
  --delay-ms 10000
```

6. Merge the prepared deployment change, or explicitly redeploy the exact `main` commit with `gh workflow run ci.yml --ref main -f operation=deploy-documentation`, then require `Publish documentation portal` to upload the same verified artifact and pass its independent public check.
7. Set the GitHub repository homepage to `https://guildcontrol.lasers.app`, disable the obsolete GitHub Pages site, and confirm that no Pages deployment action or Pages-specific repository authority remains.

Do not delete the old Pages configuration before the Worker and rollback inputs are ready. If the custom-domain verification fails during cutover, detach the Worker domain and restore the exact prior Pages binding and DNS record while diagnosing the Worker separately.

## Routine deployment and recovery

A protected `main` push deploys automatically after the full CI gate. An explicit `deploy-documentation` workflow dispatch at `main` provides a credential-rotation or same-commit recovery path without changing source. The default `verify` dispatch runs the high-cost external evidence checks without deploying. No path rebuilds inside the privileged job.

For a content or configuration regression, revert the responsible commit through the normal protected pull-request path. Avoid dashboard edits because they create unreviewed state that the source manifest cannot explain. For a suspected credential leak, revoke the token first, create a replacement with the same narrow policy, update the password-manager entry and environment secret, and dispatch the workflow at `main` to prove the replacement.

The public verifier compares the deployed documentation manifest and every declared output with the verified local artifact. It proves exact publication of those bytes at the canonical origin. It does not prove that Cloudflare, DNS, GitHub, dependencies, or the documented product behavior are free of vulnerabilities.
