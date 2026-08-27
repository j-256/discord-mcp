# Release runbook

Discord MCP uses deliberately separate release operations for a credential-free first-publication candidate, normal staged npm publication, immutable OCI publication, MCP Registry registration, and an immutable GitHub Release. No operation contacts Discord or needs a Discord bot token.

## Public-source preflight

Changing the repository from private to public exposes its reachable Git history and Actions history, permits public forks, publishes repository activity, and disables existing push rulesets. Treat the change as an irreversible disclosure even though GitHub permits a later visibility change.

Before changing visibility:

1. Create a mirror clone of the exact private remote outside the working repository. Enumerate every advertised ref, run strict Git object verification, and retain the mirror until the public transition and protections are verified.
2. Run a reviewed credential scanner in full-redaction mode across every reachable commit, the selected current tree, every retained Actions log, and every retained artifact including nested archives. Classify every candidate from rule, path, and redacted context without printing the matched value. Rotate any real credential before proceeding.
3. Inspect commit author metadata, historical filenames, repository issues, pull requests, releases, deployments, Actions variables and secret names, environments, and public-facing repository metadata. Confirm that no private identity, path, discussion, artifact, or log should remain hidden.
4. Scan the current tree and every retained package for machine-local paths and model-, vendor-, client-, or harness-specific branding. Decide explicitly whether transparent historical references are acceptable. A zero-history-reference policy requires a separately authorized history rewrite with an external mirror backup and credential rotation where applicable.
5. Run the complete release metadata, test, coverage, build, package, dependency, and container gates on the exact commit intended for public exposure. Require the remote CI gate to pass as well.
6. Confirm that `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, privacy-safe issue forms including operator questions and verified outcomes, the pull-request template, `SECURITY.md`, CODEOWNERS, and the release runbook are present and protected.

## Repository prerequisites

Before any publication:

1. Make `j-256/discord-mcp` public. npm provenance and public GitHub attestations fail for a private source repository, and the workflow enforces this boundary.
2. Set the repository description exactly to `Least-privilege Discord MCP for privacy-safe reads, audits, and reviewed administration`. Replace its topics with the exact model- and harness-neutral topic set `ai-agents`, `automation`, `community-management`, `discord`, `discord-api`, `discord-bot`, `discord-mcp`, `least-privilege`, `mcp`, `mcp-server`, `model-context-protocol`, `moderation`, `security`, and `typescript`. Keep Issues enabled. Leave Discussions, Projects, and the wiki disabled until each has an owned maintenance purpose, and leave the homepage unset until a durable project-owned documentation location exists. Topic names are public even for a private repository, so apply this profile only after the visibility decision.
3. Create or re-enable protection for `main` after the visibility change and require the `CI gate` and CodeQL checks. Require CODEOWNERS review for workflows, package metadata, registry metadata, release scripts, security policy, and community files.
4. Enable private vulnerability reporting and its maintainer notifications. Enable and verify Dependabot alerts, secret scanning, push protection, and code scanning; a skipped private-repository CodeQL run is not public-release evidence.
5. Create a repository ruleset protecting `v*` tags from deletion, update, or unreviewed creation. Enable repository-level immutable Releases before publishing any GitHub Release. Create a GitHub Actions environment named `release`, require a human reviewer, prevent self-review when the repository plan supports it, allow deployments only from protected tags, and do not allow administrators to bypass the review gate.
6. Enable two-factor authentication on the npm maintainer account.
7. Confirm that the npm maintainer controls the `@j-256` scope.
8. Install npm 11.15 or newer for human `npm stage` review commands. The workflow uses a fixed Node.js release whose bundled npm satisfies this floor.
9. Confirm that the repository owner can administer the `discord-mcp` container package under `j-256`. The first image version is created by the protected workflow and requires one explicit visibility review before it can be made public.

The workflow must be dispatched at the same tag supplied as its input. This makes GitHub and npm provenance identify the commit that produced the package rather than the default branch's dispatch commit. The workflow accepts only an existing stable `vMAJOR.MINOR.PATCH` tag that points at the checked-out commit and is an ancestor of `origin/main`. Package metadata, the lockfile, source constants, `server.json`, and the immutable icon URL must all contain the same version.

## First npm publication

npm requires a package to exist before staged or trusted publishing can be configured. Do not bridge that boundary with a token that bypasses two-factor authentication. The first version uses a credential-free protected workflow to produce an attested candidate, followed by an interactive maintainer publication:

1. Create and push the exact release tag after its commit has passed CI on `main`.
2. Dispatch `release.yml` at that tag with operation `candidate` and the same exact tag as input:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=candidate -f tag=vMAJOR.MINOR.PATCH
```

3. Approve the protected `release` environment only after confirming the exact tag, source commit, and absent npm, OCI, and MCP Registry versions. The workflow receives no npm credential, verifies source and supply-chain state, reconstructs the archive twice, verifies its installed behavior, signs the archive, SPDX SBOM, and catalog evidence with GitHub artifact attestations, and retains the exact files.
4. Download the completed workflow artifact, inspect its archive, catalog evidence, and SBOM, and verify both archive attestations before publication:

```sh
gh run download RUN_ID --name release-evidence-candidate-vMAJOR.MINOR.PATCH
gh attestation verify j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners
gh attestation verify j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners \
  --predicate-type https://spdx.dev/Document/v2.3
```

5. From an authenticated maintainer workstation, publish that exact tarball and complete npm's interactive passkey challenge. Package metadata enables automatic provenance for normal OIDC releases, so this exceptional local first publication must explicitly disable it. The protected GitHub artifact attestations verified above remain the first version's public provenance:

```sh
npm login --auth-type=web
npm whoami
npm publish ./j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz --access public --provenance=false
```

6. After npm makes the version available, require its published SHA-512 integrity to match the candidate before any OCI or MCP Registry operation:

```sh
node scripts/check-published-artifacts.mjs \
  --tarball ./j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --expect-package matching \
  --expect-npm matching \
  --expect-oci missing \
  --expect-registry missing
```

The first version's public provenance is the GitHub artifact attestation bound to the protected workflow, tag, and source commit. Publishing the exact tarball preserves that byte identity. npm OIDC provenance begins with later stage-only trusted publications because npm cannot configure that trust relationship before the package exists.

## Configure trusted staged publishing

Immediately after the first publication, configure the npm package's trusted publisher with these exact boundaries:

- Provider: GitHub Actions
- Repository owner: `j-256`
- Repository: `discord-mcp`
- Workflow: `release.yml`
- Environment: `release`
- Permission: allow staged publishing and disallow direct publishing

Set package publishing access to require two-factor authentication and disallow tokens. The trusted publisher may run `npm stage publish`; a human still supplies 2FA for `npm stage approve`. No npm token belongs in any release workflow.

## Prepare a version

1. Update `version` in `package.json`, the lockfile root, `CONNECTOR_VERSION` in `src/constants.ts`, the npm version and OCI image tag in `server.json`, the runtime `VERSION` default in `Dockerfile`, and the version segment in the icon URL.
2. Run the complete local gate:

```sh
npm run deps:locked
npm run metadata:check
npm run config:schema:check
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run pack:verify
npm run container:verify
npm run container:index:verify
npm run security:check
npm run --silent sbom -- --output sbom.spdx.json
```

3. Commit the version as a release preparation change and let CI pass on `main`.
4. Create the exact `vMAJOR.MINOR.PATCH` tag on that commit and push the tag.

Do not include `sbom.spdx.json` from the local command in the commit. The workflow reconstructs its own SBOM and release archive.

## Stage and approve npm

1. Dispatch the protected workflow:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=stage -f tag=vMAJOR.MINOR.PATCH
```

2. Review the workflow's package, deterministic catalog evidence, SPDX artifacts, and GitHub attestation summary. The workflow verifies source, dependency locks, registry signatures, vulnerabilities, the public versioned icon, official MCP manifest validation, byte-for-byte repeatability, installed CLI behavior, and a content-free installed MCP handshake before staging.
3. Inspect the private npm stage from a maintainer workstation:

```sh
npm stage list @j-256/discord-mcp
npm stage view STAGE_ID
npm stage download STAGE_ID
```

4. Compare the downloaded stage with the workflow artifact. Reject it if any digest or metadata differs.
5. Approve with human 2FA:

```sh
npm stage approve STAGE_ID
```

If the candidate is wrong, use `npm stage reject STAGE_ID`, fix the source, and create a new version. A staged semantic version cannot be reused until the rejected stage is removed.

## Publish and verify OCI

Publish the OCI image only after npm exposes the exact approved version:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=image -f tag=vMAJOR.MINOR.PATCH
```

The protected image operation reconstructs the npm archive from the tag and requires it to match the public npm integrity before inspecting the exact OCI tag through an authenticated registry request. If the tag is absent, it builds and publishes `linux/amd64` and `linux/arm64` manifests under `ghcr.io/j-256/discord-mcp:MAJOR.MINOR.PATCH`. Both stages use the same reviewed digest-pinned Node.js base. The image runs as an unprivileged user, defaults to credential-free catalog mode, and contains only the compiled server, production dependencies, package metadata, and license.

Before publishing, the workflow exports and validates the complete multi-architecture OCI layout with digest-pinned BuildKit, architecture-emulation, and SBOM-generator images. It verifies every referenced blob and requires the exact platform, annotation, configuration, layer-binding, provenance, and SPDX structure. BuildKit evidence may use its legacy compatibility image config or its OCI artifact encoding. The artifact form must name the exact runnable manifest as its subject and use OCI's canonical empty JSON config descriptor. The release build then binds BuildKit provenance and SPDX records for both platform manifests into the root index and pushes signed GitHub provenance for that exact root digest. It requires the public index to match the preflight invariants, runs the pulled image with a read-only root filesystem and no network or Linux capabilities, compares its catalog evidence to the source contract, and verifies the signed root claim against the exact repository, workflow, tag ref, and source commit.

BuildKit `mode=max` identifies the provenance record's detail level, not a maximum security or SLSA assurance level. The [provenance, SBOM, and attestation boundaries](reference.md#provenance-sbom-and-attestation-boundaries) distinguish the build receipt, detected software inventory, signed artifact binding, and guarantees that still require independent review.

GitHub creates a new personal container package as private by default. On the first image publication, the workflow may publish and attest the immutable tag and then fail its anonymous-read check with a recovery instruction. Open the package settings, confirm that the source repository is linked, review the package contents and permissions, and change visibility to Public. Visibility changes are consequential and may be irreversible, so do this only after the review. Rerun the same protected `image` operation. It detects the existing exact tag, does not overwrite or re-attest it, and completes only if the now-public digest and behavior match the release.

If the exact tag already exists but any digest, platform, annotation, image configuration, attestation, or runtime proof differs, the operation fails closed. Fix the source and publish a new semantic version; never replace a published tag.

## Register the promoted version

After npm and the public OCI image expose the same approved version, dispatch:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=register -f tag=vMAJOR.MINOR.PATCH
```

The register operation reconstructs the package from the tag, requires its SHA-512 integrity to equal npm's published integrity, and requires the public OCI index and every platform configuration to match the same version and source commit. It downloads MCP Registry publisher `v1.8.1` from the official release, verifies the pinned Linux archive SHA-256, validates `server.json`, authenticates with GitHub OIDC, and publishes only when the exact registry version is absent. Metadata checks require the npm entry to pass one config-file argument, the OCI entry to use one read-only config mount and the hardened operational command, and both entries to request only the bot-token secret. An already matching registry entry is a successful no-op. Existing mismatched metadata fails closed.

## Publish the immutable GitHub Release

After npm, the public OCI image, and the MCP Registry expose the same exact version, dispatch the final protected operation:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=github-release -f tag=vMAJOR.MINOR.PATCH
```

The read-only release job reconstructs the npm archive and SPDX SBOM, verifies the package, image, and Registry version as one public identity, signs the reconstructed evidence, and retains it for the publisher job. The dependent publisher job alone receives `contents: write`, plus read-only access to that run's artifacts and GitHub attestations. It installs the exact SHA-256-pinned GitHub CLI archive, downloads only that run's evidence, resolves the protected tag to the exact source commit, and generates deterministic release notes and `SHA256SUMS`. GitHub does not expose its repository-level immutable-Releases setting to `GITHUB_TOKEN`, so the protected environment reviewer must confirm that setting before approving this job; automation receives no standing repository-administration credential.

An absent Release is created as a draft. An existing draft may be reconciled only for the exact asset set below, then its tag, title, notes, asset names, sizes, SHA-256 digests, download URLs, and source commit are verified before publication:

- `j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz`
- `catalog-evidence.json`
- `release-notes.md`
- `sbom.spdx.json`
- `SHA256SUMS`

Publishing locks the tag and assets when repository-level immutable Releases remain enabled and creates GitHub's Release attestation over the tag, commit, and assets. GitHub still permits the displayed Release title and body to be edited, so `release-notes.md` is the canonical immutable copy and is covered by `SHA256SUMS`. The workflow waits for the immutable postcondition, verifies the Release attestation and every asset attestation, downloads every public asset, compares each byte-for-byte with the protected evidence, and verifies the checksum manifest. A matching immutable Release is a successful no-op. A mutable published Release, mismatched immutable Release, prerelease, unexpected asset, or draft that cannot be reconciled exactly fails closed. The workflow never deletes a Release or an unexpected asset.

## Independent verification

Verify the immutable GitHub Release, download its exact assets, verify each local asset against GitHub's Release attestation, and check the checksum manifest:

```sh
mkdir discord-mcp-release
gh release verify vMAJOR.MINOR.PATCH --repo j-256/discord-mcp
gh release download vMAJOR.MINOR.PATCH --repo j-256/discord-mcp --dir discord-mcp-release
gh release verify-asset vMAJOR.MINOR.PATCH discord-mcp-release/j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz --repo j-256/discord-mcp
gh release verify-asset vMAJOR.MINOR.PATCH discord-mcp-release/release-notes.md --repo j-256/discord-mcp
(cd discord-mcp-release && shasum -a 256 -c SHA256SUMS)
```

`gh release verify` establishes GitHub's signed binding among the immutable tag, source commit, and complete asset digest set. `gh release verify-asset` establishes that the local file is one exact attested asset. The checksum manifest makes the package, catalog evidence, canonical notes, and SBOM directly comparable with ordinary local tools. These integrity checks establish identity and origin, not freedom from defects, vulnerabilities, malicious source, or scanner omissions.

Download the exact npm package and verify both provenance and its SBOM attestation:

```sh
npm pack @j-256/discord-mcp@MAJOR.MINOR.PATCH
gh attestation verify j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners
gh attestation verify j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners \
  --predicate-type https://spdx.dev/Document/v2.3
gh attestation verify catalog-evidence.json \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners
```

From an isolated consumer directory, install the downloaded archive without lifecycle scripts and save the credential-free catalog evidence:

```sh
npm install --ignore-scripts ./j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz
./node_modules/.bin/discord-mcp catalog --check --json > catalog-evidence.json
```

The evidence must be identical across repeated runs of the same installed archive. Review its exact inventories and accounting fields, preserve its `contractDigest` for contract comparison, and preserve its separate `safetyResourceDigest` for focused safety-guidance comparison. The report must state that credentials, Discord execution, Gateway access, telemetry export, and activity persistence are disabled.

Authenticate the container client, pull the exact image, verify its signed root provenance from the OCI registry, inspect the root-bound per-platform SPDX records, and run its credential-free catalog under the recommended restrictions:

```sh
docker pull ghcr.io/j-256/discord-mcp:MAJOR.MINOR.PATCH
gh attestation verify oci://ghcr.io/j-256/discord-mcp:MAJOR.MINOR.PATCH \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/vMAJOR.MINOR.PATCH \
  --deny-self-hosted-runners \
  --bundle-from-oci
docker run --rm -i \
  --network=none \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --pids-limit=64 \
  ghcr.io/j-256/discord-mcp:MAJOR.MINOR.PATCH catalog --check --json > container-catalog-evidence.json
```

Review the image index with `docker buildx imagetools inspect ghcr.io/j-256/discord-mcp:MAJOR.MINOR.PATCH`. It must expose only `linux/amd64` and `linux/arm64` as runnable platforms, retain the reviewed index description and source annotations, and bind BuildKit evidence to both manifests. The container catalog evidence must be byte-identical across repeated runs and match the installed npm package's evidence.

From a checkout of the same tag, compare npm and MCP Registry state with the same code used by release automation:

```sh
node scripts/check-published-artifacts.mjs \
  --tarball j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --expect-package matching \
  --expect-npm matching \
  --expect-oci matching \
  --expect-registry matching
```

The exact registry response is also available from `https://registry.modelcontextprotocol.io/v0.1/servers/io.github.j-256%2Fdiscord-mcp/versions/MAJOR.MINOR.PATCH`.

## Failed or compromised releases

- Reject an unapproved npm stage and publish a corrected new version
- Deprecate a flawed public npm version and publish a corrected new version rather than overwriting it
- Publish a corrected OCI image under a new semantic version rather than overwriting or reusing an existing tag
- Leave a malformed draft unpublished for explicit maintainer cleanup; publish a corrected semantic version if an immutable GitHub Release is wrong
- Revoke a suspected credential immediately and preserve workflow logs without copying secrets into an issue
- Use npm unpublish only for a confirmed security emergency and after evaluating downstream breakage
- Publish corrected MCP Registry metadata under the corrected package version; never claim mismatched metadata is equivalent

## Platform references

- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm scoped public package publication](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm bypass-2FA token restrictions](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)
- [GitHub workflow event refs and SHAs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub repository visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
- [GitHub security and analysis settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
- [GitHub artifact and SBOM attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub immutable Releases](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub Release integrity verification](https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)
- [GitHub container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub package visibility and access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Docker multi-platform images](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [OCI annotations with Buildx](https://docs.docker.com/build/metadata/annotations/)
- [BuildKit attestation storage](https://github.com/moby/buildkit/blob/master/docs/attestations/attestation-storage.md)
- [MCP Registry publishing quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [MCP Registry publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)
