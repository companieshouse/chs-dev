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
Refreshing downloads version metadata; Apply or Start reconciles the containers.
Explicit image pins take precedence over the global source. Choosing a different
source in a service's Versions row clears its old pin.

Infrastructure and public images retain their project versions. The reader prefers
canonical deployments and does not choose between conflicting digests or shared
sidecar images. A service absent or ambiguous in the global environment keeps its
project image with a warning and is marked **Unmapped; project default**. An
explicit per-service environment override instead fails preparation if no exact
version is available; choose Project default or a specific version to resolve it.
If the environment cannot be read, preparation fails rather than substituting latest.

AWS access uses ECS ListClusters, ListTasks and DescribeTasks only, with no AWS
writes. The default profiles are `development-eu-west-2`, `staging`, and `live`,
all in `eu-west-2`. The corresponding environment must appear in the ECS cluster
name. CIDEV discovery ignores other development clusters. Authenticate these
profiles using your normal AWS login. Environment selection does not change the
daemon's primary AWS or ECR login settings.

CIDEV discovery has been checked against running ECS tasks. Staging and Live use
the same reader and are covered with fixtures; their accounts were not queried
during this change. Runtime digests may be architecture-specific, so x86_64 images
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
