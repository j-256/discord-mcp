# Release runbook

Discord MCP uses three deliberately separate release operations: one-time npm bootstrap, normal staged npm publication, and MCP Registry registration. No operation contacts Discord or needs a Discord bot token.

## Repository prerequisites

Before any publication:

1. Make `j-256/discord-mcp` public. npm provenance and public GitHub attestations fail for a private source repository, and the workflow enforces this boundary.
2. Keep `main` protected and require the `CI gate` and CodeQL checks. Require CODEOWNERS review for workflows, package metadata, registry metadata, release scripts, and security policy.
3. Create a repository ruleset protecting `v*` tags from deletion, update, or unreviewed creation. Create a GitHub Actions environment named `release`, require a human reviewer, prevent self-review when the repository plan supports it, allow deployments only from protected tags, and do not allow administrators to bypass the review gate.
4. Enable two-factor authentication on the npm maintainer account.
5. Confirm that the npm maintainer controls the `@j-256` scope.
6. Install npm 11.15 or newer for human `npm stage` review commands. The workflow uses a fixed Node.js release whose bundled npm satisfies this floor.

The workflow must be dispatched at the same tag supplied as its input. This makes GitHub and npm provenance identify the commit that produced the package rather than the default branch's dispatch commit. The workflow accepts only an existing stable `vMAJOR.MINOR.PATCH` tag that points at the checked-out commit and is an ancestor of `origin/main`. Package metadata, the lockfile, source constants, `server.json`, and the immutable icon URL must all contain the same version.

## One-time npm bootstrap

Staged and trusted publishing cannot create a package that does not exist. Bootstrap is a one-use exception:

1. Create a short-expiration npm granular access token that can create `@j-256/discord-mcp` and is permitted to bypass publication 2FA for this operation. Do not grant unrelated organization or package access.
2. Add it as the `NPM_BOOTSTRAP_TOKEN` environment secret in GitHub's protected `release` environment.
3. Create and push the exact release tag after its commit has passed CI on `main`.
4. Dispatch `release.yml` at that tag with operation `bootstrap` and the same exact tag as input. The job refuses to proceed if the GitHub repository is private, the workflow ref differs from the tag input, the npm package or version already exists, the MCP Registry version exists, any source or supply-chain check fails, or the protected secret is absent.
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

1. Update `version` in `package.json`, the lockfile root, `CONNECTOR_VERSION` in `src/constants.ts`, `version` fields in `server.json`, and the version segment in the icon URL.
2. Run the complete local gate:

```sh
npm run deps:locked
npm run metadata:check
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run pack:verify
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

2. Review the workflow's package and SPDX artifacts and the GitHub attestation summary. The workflow verifies source, dependency locks, registry signatures, vulnerabilities, the public versioned icon, official MCP manifest validation, byte-for-byte repeatability, installed CLI behavior, and a content-free installed MCP handshake before staging.
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

## Register the promoted version

After npm exposes the approved version, dispatch:

```sh
gh workflow run release.yml --ref vMAJOR.MINOR.PATCH -f operation=register -f tag=vMAJOR.MINOR.PATCH
```

The register operation reconstructs the package from the tag and requires its SHA-512 integrity to equal npm's published integrity. It downloads MCP Registry publisher `v1.8.1` from the official release, verifies the pinned Linux archive SHA-256, validates `server.json`, authenticates with GitHub OIDC, and publishes only when the exact registry version is absent. An already matching registry entry is a successful no-op. Existing mismatched metadata fails closed.

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
```

From a checkout of the same tag, compare npm and MCP Registry state with the same code used by release automation:

```sh
node scripts/check-published-artifacts.mjs \
  --tarball j-256-discord-mcp-MAJOR.MINOR.PATCH.tgz \
  --expect-package matching \
  --expect-npm matching \
  --expect-registry matching
```

The exact registry response is also available from `https://registry.modelcontextprotocol.io/v0.1/servers/io.github.j-256%2Fdiscord-mcp/versions/MAJOR.MINOR.PATCH`.

## Failed or compromised releases

- Reject an unapproved npm stage and publish a corrected new version
- Deprecate a flawed public npm version and publish a corrected new version rather than overwriting it
- Revoke a suspected credential immediately and preserve workflow logs without copying secrets into an issue
- Use npm unpublish only for a confirmed security emergency and after evaluating downstream breakage
- Publish corrected MCP Registry metadata under the corrected package version; never claim mismatched metadata is equivalent

## Platform references

- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [GitHub workflow event refs and SHAs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub artifact and SBOM attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [MCP Registry publishing quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [MCP Registry publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)
