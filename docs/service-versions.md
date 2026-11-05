# Service provider versions

The global version source defaults to **CIDEV**. CHS services in Service mode use
the image digest running in that environment. Changing the source preserves
enabled services, exclusions, providers and mock scenarios.

## TUI

Press **Ctrl+E → v**. Choose **CIDEV**, **Staging**, **Live**, **Latest** or
**Project default**, then press Enter. The choice is saved; choose Apply or Start
when ready. This replaces the export/import workflow for selecting an environment.

Open a service with Enter and select its **Versions** row to override the default:

- **Environment default** follows the global choice.
- **CIDEV / Staging / Live** selects that service's deployed image.
- **Latest** selects the repository's `latest` tag explicitly.
- **Specific version…** accepts a version tag (for example `2.0.39`), a SHA256
  digest, or a full image reference. Empty input resets to the environment default.
- **Project default** uses the image reference from the project's Compose file.

Choose Save in the service modal after editing. Service edits and the global
source choice wait for an explicit Apply or Start.
Version settings are retained while the service uses Mock or Development. Those
providers continue using their mock contract or local source and do not fetch
environment versions for that service.

## Resolving versions

The first Apply or Start that needs an environment reads running ECS tasks. The
cache is private, persists across daemon restarts, and expires after five minutes.
Press **r** in the Versions screen to refresh the highlighted environment now.
Refreshing downloads version metadata without changing containers. Explicit Apply
reevaluates the selected configuration and source images, even when the YAML has
not changed; it can check credentials, download metadata and reconcile images.
Start also resolves the selected source. Reload uses the applied artifacts and
does not activate refreshed image metadata for unrelated services.
Explicit image pins take precedence over the global source. Choosing a different
source in a service's Versions row clears its old pin.

Infrastructure and public images retain their project versions. The reader prefers
canonical deployments and does not choose between conflicting digests or shared
sidecar images. A service absent or ambiguous in the global environment keeps its
project image with a warning and is marked **Unmapped; project default**. An
explicit per-service environment override instead fails preparation if no exact
version is available; choose Project default or a specific version to resolve it.
If the environment cannot be read, preparation fails rather than substituting latest.
A DescribeTasks response that omits requested tasks is rejected as an incomplete
snapshot. Failed reads do not replace an existing good snapshot, and cache publication is
atomic. Cancellation is checked before publication. A cancelled shared-read caller
receives a cancellation outcome even if another caller successfully publishes a
complete snapshot.

AWS access uses ECS ListClusters, ListTasks and DescribeTasks only, with no AWS
writes. The default profiles are `development-eu-west-2`, `staging`, and `live`,
all in `eu-west-2`. The corresponding environment must appear in the ECS cluster
name. CIDEV discovery ignores other development clusters. Authenticate these
profiles using your normal AWS login. Environment selection does not change the
daemon's primary AWS or ECR login settings.

CIDEV, Staging and Live use the same reader and are covered with injected ECS
responses in this delivery. No AWS account was queried during local acceptance. Runtime digests may be architecture-specific, so x86_64 images
need a compatible runtime or emulation on ARM machines.

## CLI and sharing

```sh
npm run dev -- environment source cidev
npm run dev -- environment source staging
npm run dev -- service configure felixvalidator --version-source live
npm run dev -- service configure felixvalidator --version-source latest
npm run dev -- service configure felixvalidator --image REGISTRY/felixvalidator:2.0.39
npm run dev -- service configure felixvalidator --version-source default
npm run dev -- apply
```

The global choice is stored as `versionSource` and service overrides as
`serviceVersionSources` in `.chs-dev.yaml`. Explicit versions use `serviceImages`.
[Environment exports](environment-profiles.md) include these choices and resolve
active Service images into pins so another developer can reproduce the captured
versions. Export may read AWS when an environment's cache is missing or expired.
Importing the file restores those explicit pins; select Environment default in a
service's Versions row to resume following an environment.

## Saved preferences and observed images

The Services table's **SAVED VER** column describes the selected Service image,
not the image in an existing container. Selection details show **Observed image**
and **Image ID** from engine inspection separately. Use **i details** for full
references or long IDs. Development and Mock retain their previous Service image
choices, labelled **Inactive Service version/source** until switched to Service.
The source name (`cidev`, `staging`, `live`, `latest` or `compose`) is not itself a
resolved version; an unavailable version is shown as `—`.

```sh
chs-dev service show SERVICE --json
chs-dev service list --json
```

Existing image fields describe saved image choices. The `observed` array includes
each existing service/helper container's actual image reference, engine `imageId`,
mode and lifecycle. Containers and container inspection also use the engine image
rather than a saved metadata label. An engine image ID is not necessarily the
registry manifest digest; it is labelled separately. Missing inspection evidence
stays absent, and a stopped container is not proof that this image is running.

Copying an image does not align source branches, service configuration, database
schemas or datasets across CIDEV, Staging, Live and local development. Those
compatibility and ownership decisions remain outside this feature.

## Local acceptance

`node scripts/test-local.mjs test/service-versions.test.ts test/cidev-versions.test.ts test/version-preparation.test.ts test/version-visibility.test.ts`
runs real version/cache/preparation and CLI/client/Ink paths with injected ECS and
container boundaries. It covers all three source environments, explicit pins,
Development/Mock exclusions, cache expiry and persistence, ambiguous/missing
images, incomplete task responses, cancellation, observed/saved image visibility
and deliberate metadata refresh without automatic runtime changes. It does not
establish live account access, image architecture availability or configuration/data
parity. No manual verification or live services are required for these tests.
