# Release runbook

Discord MCP uses deliberately separate release operations for one-time npm bootstrap, normal staged npm publication, immutable OCI publication, and MCP Registry registration. No operation contacts Discord or needs a Discord bot token.

## Repository prerequisites

Before any publication:

1. Make `j-256/discord-mcp` public. npm provenance and public GitHub attestations fail for a private source repository, and the workflow enforces this boundary.
2. Keep `main` protected and require the `CI gate` and CodeQL checks. Require CODEOWNERS review for workflows, package metadata, registry metadata, release scripts, and security policy.
3. Create a repository ruleset protecting `v*` tags from deletion, update, or unreviewed creation. Create a GitHub Actions environment named `release`, require a human reviewer, prevent self-review when the repository plan supports it, allow deployments only from protected tags, and do not allow administrators to bypass the review gate.
4. Enable two-factor authentication on the npm maintainer account.
5. Confirm that the npm maintainer controls the `@j-256` scope.
6. Install npm 11.15 or newer for human `npm stage` review commands. The workflow uses a fixed Node.js release whose bundled npm satisfies this floor.
7. Confirm that the repository owner can administer the `discord-mcp` container package under `j-256`. The first package version is created by the protected workflow and requires one explicit visibility review before it can be made public.

The workflow must be dispatched at the same tag supplied as its input. This makes GitHub and npm provenance identify the commit that produced the package rather than the default branch's dispatch commit. The workflow accepts only an existing stable `vMAJOR.MINOR.PATCH` tag that points at the checked-out commit and is an ancestor of `origin/main`. Package metadata, the lockfile, source constants, `server.json`, and the immutable icon URL must all contain the same version.

## One-time npm bootstrap

Staged and trusted publishing cannot create a package that does not exist. Bootstrap is a one-use exception:

1. Create a short-expiration npm granular access token that can create `@j-256/discord-mcp` and is permitted to bypass publication 2FA for this operation. Do not grant unrelated organization or package access.
2. Add it as the `NPM_BOOTSTRAP_TOKEN` environment secret in GitHub's protected `release` environment.
3. Create and push the exact release tag after its commit has passed CI on `main`.
4. Dispatch `release.yml` at that tag with operation `bootstrap` and the same exact tag as input. The job refuses to proceed if the GitHub repository is private, the workflow ref differs from the tag input, the npm package, OCI tag, or MCP Registry version already exists, any source or supply-chain check fails, or the protected secret is absent.
5. Confirm that npm shows the exact version and provenance before continuing.
6. Delete `NPM_BOOTSTRAP_TOKEN` from the GitHub environment and revoke the npm token. Do not retain a bootstrap token for recovery.

Bootstrap publishes the already verified tarball rather than asking npm to repack the checkout. The workflow then requires npm's published SHA-512 integrity to match that tarball.

## Configure trusted staged publishing

After bootstrap, configure the npm package's trusted publisher with these exact boundaries:

- Provider: GitHub Actions
- Repository owner: `j-256`
- Repository: `discord-mcp`
- Workflow: `release.yml`
- Environment: `release`
- Permission: allow staged publishing and disallow direct publishing

Set package publishing access to require two-factor authentication and disallow tokens. The trusted publisher may run `npm stage publish`; a human still supplies 2FA for `npm stage approve`. No npm token belongs in the workflow after bootstrap.

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

GitHub creates a new personal container package as private by default. On the first image publication, the workflow may publish and attest the immutable tag and then fail its anonymous-read check with a recovery instruction. Open the package settings, confirm that the source repository is linked, review the package contents and permissions, and change visibility to Public. Visibility changes are consequential and may be irreversible, so do this only after the review. Rerun the same protected `image` operation. It detects the existing exact tag, does not overwrite or re-attest it, and completes only if the now-public digest and behavior match the release.

If the exact tag already exists but any digest, platform, annotation, image configuration, attestation, or runtime proof differs, the operation fails closed. Fix the source and publish a new semantic version; never replace a published tag.

## Register the promoted version

After npm and the public OCI image expose the same approved version, dispatch:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=register -f tag=vMAJOR.MINOR.PATCH
```

The register operation reconstructs the package from the tag, requires its SHA-512 integrity to equal npm's published integrity, and requires the public OCI index and every platform configuration to match the same version and source commit. It downloads MCP Registry publisher `v1.8.1` from the official release, verifies the pinned Linux archive SHA-256, validates `server.json`, authenticates with GitHub OIDC, and publishes only when the exact registry version is absent. Metadata checks require the npm entry to pass one config-file argument, the OCI entry to use one read-only config mount and the hardened operational command, and both entries to request only the bot-token secret. An already matching registry entry is a successful no-op. Existing mismatched metadata fails closed.

## Independent verification

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
- Revoke a suspected credential immediately and preserve workflow logs without copying secrets into an issue
- Use npm unpublish only for a confirmed security emergency and after evaluating downstream breakage
- Publish corrected MCP Registry metadata under the corrected package version; never claim mismatched metadata is equivalent

## Platform references

- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [GitHub workflow event refs and SHAs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub artifact and SBOM attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub package visibility and access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Docker multi-platform images](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [OCI annotations with Buildx](https://docs.docker.com/build/metadata/annotations/)
- [BuildKit attestation storage](https://github.com/moby/buildkit/blob/master/docs/attestations/attestation-storage.md)
- [MCP Registry publishing quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [MCP Registry publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)
