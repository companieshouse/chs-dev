# Native orchestration

Historical design retained for reference. Native Docker and Apple execution have been removed. See the [current transition guide](../compose-transition.md).

The native backend manages Docker or Apple containers directly through a shared
planner. Docker Compose remains the default execution backend. Both native
runtimes now compile prepared CHS definitions without invoking Compose.

## Selecting the backend

In Config, set **Orchestration** to **Native**. The daemon stops the current
environment before activating the new backend; choose Start when ready. The
settings file equivalent is:

```yaml
runtime: docker
orchestrator: native
```

Or launch with `CHS_DEV_ORCHESTRATOR=native npm run dev` from this package. Use
`orchestrator: compose` to return to Compose. `CHS_DEV_ORCHESTRATOR` overrides the
settings file; omitting the setting preserves Compose behaviour.

Before switching, use **Stop environment** in the current backend. A persistent checkout marker blocks switching an active environment between
backends. Native Docker also checks engine ownership, including stopped
containers. When upgrading a checkout with legacy native Docker state, stop it
once using Docker / Native before selecting Apple. Existing Compose volumes are never adopted or
migrated. Native named volumes, generated files, build output and Tempo data use
separate backend storage. Repository source mounts and dependency caches remain
shared.

Native mode is opt-in and experimental while broader application-module acceptance
continues. It supports local Unix-socket Docker contexts, including Docker Desktop
and Colima. Remote SSH/TLS endpoints require the Compose backend. Docker and BuildKit must be installed for the Docker runtime; Compose is
required only for the Compose backend and compiler parity tests. Container operations
negotiate Engine API 1.44–1.47; platform-specific image inspection uses the installed
Docker CLI and requires its `image inspect --platform` support when necessary.

## Behaviour

- Start and Apply compile the effective definitions and reconcile actual runtime
  state. Unchanged containers and successful jobs are reused. Definition and image
  changes are checked even when `.chs-dev.yaml` has not changed.
- Dependencies distinguish started containers, healthy containers and successful
  one-shot jobs. Builders and initialization runners are jobs; an ordinary service
  exiting zero is not considered a successful job.
- Explicit dependency changes propagate through `depends_on.restart: true`.
  Docker's own restart policy remains separate from dependency propagation.
- Reload rebuilds the selected development service, reruns its owned builder and
  replaces its application. Local builds disable provenance so cached builds do
  not change image identity merely because another attestation was generated.
- Health checks and restart policies continue in Docker after the TUI exits.
  There is no background orchestration daemon. Polling never restarts manually
  stopped services; explicit Apply may start them again.
- Stop removes owned containers in reverse dependency order, preserving named and
  anonymous volumes. Networks are retained and reused. No global Docker prune or
  automatic storage migration is performed.
- Cancellation does not promise rollback. Retry inspects actual state and resumes
  from what exists, including containers created before a command response was
  received.
- Apply waits for selected services to become ready and selected jobs to complete.
  Defaults are four concurrent container operations, two pulls, one build, a
  ten-minute readiness deadline and a thirty-minute job/build deadline.

Per-service Start, Stop, Restart and logs use the same backend and ownership checks.
Native containers use exact service names, such as `acsp-api` and `mongo`.
Docker requires names to be unique across the engine, so two environments cannot
run the same service name simultaneously. Apply checks for conflicts before
changing containers and never renames or removes a foreign container.
Service names and declared `container_name` values remain network aliases.

Native containers carry [Docker project/service labels](https://docs.docker.com/reference/compose-file/services/#labels) for Desktop grouping under
`<project>-native-<checkout hash>`. Native ownership still uses `chs.dev.*` labels;
the group is separate from the real Compose project. Compose execution labels
(`config-hash`, configuration files and working directory) are deliberately absent.
Use chs-dev to control the environment and preserve dependency/readiness ordering.
Desktop's presentation can vary by version; the grouping metadata does not make
native mode a Compose-managed application.

On the next Apply, containers with old names or missing grouping labels are
recreated once. Named and anonymous volumes retain their existing identities and
data. Initialization jobs use the new exact target names.

## Implementation boundaries

`domain/orchestration.ts` defines the runtime-independent resolved service model,
planner and bounded dependency scheduler. It contains no Docker or filesystem
calls.

`infrastructure/native/compiler.ts` provides the injectable `DefinitionCompiler`.
`PortableDefinitionCompiler` reads the single prepared YAML document and resolves
the supported CHS subset: interpolation, environment files, command vectors,
mounts, ports, dependencies, build inputs and file-backed secrets/configs. It
rejects unsupported fields with service/source context.
`ComposeDefinitionCompiler` remains a test oracle (`npm run test:compiler:parity`).
Neither native backend invokes Compose during ordinary operation.

`infrastructure/native/runtime.ts` implements project execution behind the existing
`LiveRuntime` contract. Its shared `NativeOrchestrator` consumes the typed
`ContainerOperations`, `ImageOperations` and `ResourceOperations` ports in
`domain/runtime-adapter.ts`. `DockerRuntimeAdapter` and `AppleRuntimeAdapter` implement the same ports. `LiveController` retains
authentication recovery, operation
locking, cancellation and user intent. The native backend owns dependency
scheduling and desired-versus-observed reconciliation; Compose keeps its own
execution path.

The Docker adapter uses HTTP over a pinned Unix socket for containers, resources
and inspection. Pulls and builds use the Docker CLI with the same pinned endpoint.
Registry login keeps the existing helper and receives that endpoint too. Argument
arrays, exec-form health checks and multiline environment values are preserved by
Engine API requests rather than shell translation.

`PortableChsAdapter` supplies the shared CHS integrations. Initialization tasks
execute scripts through the selected runtime. Like the Compose script runner,
a script that returns a nonzero exit code produces a warning and the remaining
scripts continue. The task completes with warnings so dependent services can
start; statements after an error within an individual script may not have run.
The task logs retain the script path, exit code and sanitized diagnostic.

Each completed attempt is checkpointed against its contents and the target's
storage identity, including attempts that produced warnings. Unchanged scripts
are skipped on later runs, with previous warnings reported again. Changing the
script, replacing its data storage or setting `FORCE_RUN` on the initialization
service reruns it. Storage fingerprints ignore mount ordering, so recreating a
container with the same volumes does not rerun its scripts. Existing success-only
checkpoints remain valid and matching legacy fingerprints are upgraded in place. Cancellation,
timeouts, lost targets, unreadable scripts and runtime execution exceptions still
abort initialization; interrupted scripts are not checkpointed.

Traefik uses generated file-provider routes; Prometheus uses generated file discovery.
Neither needs the Docker socket in native mode. Build outputs and Tempo data keep
stable backend-specific paths. The Compose execution path keeps its existing
integrations.

Docker retains its native network aliases and per-container `extra_hosts`
overrides. Only Apple generates project DNS records; those DNS conflict checks
do not apply to Docker routing or monitoring discovery.

## Apple containers

Requires Apple silicon, macOS 26 or later, and matching Apple CLI/service versions
1.5.0 or a compatible newer 1.x release. The adapter validates structured output
and reports unsupported versions. Install/upgrade instructions are in the
[Apple release notes](https://github.com/apple/container/releases/tag/1.5.0).

In Config choose **Container engine → apple**. Saving also selects Native
orchestration atomically. Restart the TUI, then press **s** in Config if the Apple
service needs starting. This is an explicit action; opening the TUI does not
install software or start the engine. The settings equivalent is:

```yaml
runtime: apple
orchestrator: native
```

`CHS_DEV_RUNTIME=apple CHS_DEV_ORCHESTRATOR=native npm run dev` selects the same
backend. `CHS_DEV_APPLE_CLI` can point to a particular executable. Containers,
images, volumes and state are separate from Docker; existing Docker data is not
migrated. Exact service names remain in use and conflicts are rejected.

| Feature                      | Apple behavior                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle and Containers tab | List this checkout or all containers; inspect, bounded logs, start, stop and restart. Actions verify creation identity as well as names.                                                                                              |
| Images and builds            | Apple CLI pulls/builds only. Versioned cached images are reused; mutable tags can refresh on Apply. Polling does not pull images. ARM64 is preferred; AMD64-only images use emulation, and explicit platform requests are honored.    |
| Registry login               | AWS ECR credentials go directly to Apple registry login through stdin. Docker credentials are not required.                                                                                                                           |
| Readiness and jobs           | Image/definition health checks execute through Apple exec. Attached jobs record their actual exit result; a missing result is unknown, never assumed successful.                                                                      |
| Restart policies             | `no`, `always` and `unless-stopped`; CHS monitors and restarts while its daemon owns the checkout and supervision is authorised. Manual stops persist across sessions. `on-failure` is rejected.                                      |
| Data                         | Named and image-declared anonymous volumes survive Stop/recreation. Empty volumes receive image defaults through a temporary helper; this requires `/bin/sh`, `ls`, `sed` and `cp` in that image. Existing data is never overwritten. |
| DNS and ingress              | One isolated project network and an owned `chs-dns` CoreDNS helper. Bare service names, aliases and CHS gateway names resolve inside containers. Traefik routes update from observed endpoints.                                       |
| Development                  | Java builder jobs, Node builds, directory source mounts, file-backed SSH secrets and explicit Reload.                                                                                                                                 |
| Monitoring                   | Generated Prometheus file targets and CHS monitoring config projections; Docker socket/log mounts are removed from the known Prometheus integration.                                                                                  |

When no platform is configured, both pulls and Dockerfile builds try ARM64 first.
A platform-mismatch error triggers one retry with `linux/amd64` emulation; the
resulting container uses that platform too. Build arguments and targets are kept.
An explicit `platform` is always honored. Authentication, Dockerfile syntax and
build command failures do not trigger an architecture retry.

Apple changes IPv4 addresses after restart. The DNS helper uses a deterministic
MAC, so its IPv6 address stays stable within the retained network. Clients receive
both its current IPv4 address (available immediately at boot) and stable IPv6
address (available after IPv6 configuration), with bounded resolver retries. This
allows existing clients to recover after the DNS helper restarts. DNS publication
is acknowledged on a dedicated query port before dependencies start. Host DNS and
`/etc/hosts` are not changed. Routing files are republished with a filesystem event
inside the Traefik guest so its watcher observes updates.

The pinned Apple CLI accepts directory bind mounts, not individual file binds.
CHS secrets and known monitoring configuration files are projected into private,
versioned directories. Only declared files are exposed; secret permissions stay
private, and changing a source selects a new projection on Apply. These generated
projections are read-only snapshots, so Reload/Apply is required after editing a
file. Other individual-file mounts are rejected with instructions to mount their
parent directory. Directory source mounts remain live.

Unsupported Apple configurations fail before container changes: multiple project
networks, arbitrary host-gateway integrations, Docker API services such as
sockpuppet, automatic host-port allocation, custom resource drivers/options and
unsupported restart policies. This is staged CHS compatibility, not unrestricted
Compose emulation. A volume initialization image without the required helper
commands fails with a service/volume-specific error and retains the volume.

Default VM limits are two CPUs and 2 GiB; the build VM gets 4 GiB and DNS gets
256 MiB. `CHS_DEV_APPLE_CPUS`, `CHS_DEV_APPLE_MEMORY` and
`CHS_DEV_APPLE_BUILD_MEMORY` override defaults; explicit service memory limits win.
Apple requires at least 200 MiB per VM. Capacity-plan large stacks accordingly.

Exiting the TUI leaves containers running. Health checks, restart recovery and
endpoint publication pause until a TUI reacquires the checkout lock. There is no
installed CHS supervisor. Apple inspect does not expose a reliable historic exit
code for detached services; their unknown exit status is displayed honestly.

Run the opt-in Apple acceptance suite on the selected Apple engine:

```sh
npm run test:apple
```

The suite covers lifecycle/DNS restart, successful jobs, retained storage, stale
selection rejection, image health/volume inheritance, Prometheus discovery,
Mongo initialization/ingress, Kafka advertised listeners with AMD64 emulation,
Java/Node development, and automatic AMD64 fallback for Dockerfile builds and
reloads. It uses exact fixture names and removes only resources
owned by its temporary checkouts. `CHS_APPLE_GUEST_HTTP=1` checks ingress from a
container instead of macOS when host filtering prevents direct HTTP connections;
that mode does **not** validate published-port access from the host. Full private
application modules still require validation with the relevant account.

For a focused build check using the project's private Node 24 development image,
run the platform test with an authenticated Apple registry session:

```sh
CHS_APPLE_INTEGRATION=1 CHS_APPLE_CHS_BUILD_ROOT=/path/to/docker-chs-development \
  node --import tsx --test test/integration/apple-build-platform.test.ts
```

Without `CHS_APPLE_CHS_BUILD_ROOT`, that test uses a public AMD64-only Alpine
image. It builds and runs an isolated fixture, then verifies a cached rebuild.

## State and safety

Native state lives beneath the existing per-checkout XDG state directory in
`native/` for Docker or `native-apple/` for Apple. It includes a private HMAC key, a redacted operation journal, anonymous
volume mappings, generated configuration and stable writable build output.

Service fingerprints include effective configuration, selected image identity,
file-backed secrets/configuration and initialization-script contents. Apple
additionally keeps private lifecycle metadata, initialization checkpoints and
versioned file projections; projected secrets remain beneath the private checkout
state directory. Treat that directory as sensitive. They exclude
source-provenance paths and operation identifiers. Source directories mounted for
development are not recursively hashed; use Reload when a build is needed.

Runtime inspection is authoritative. The journal contains action outcomes and
resource identifiers, not resolved environment variables or Docker request bodies.
Compiler output and private build output are not streamed into logs. Container and
resource ownership is verified before mutation; foreign resources are never
adopted. Changed network/volume definitions are blocked instead of automatically
replacing persistent resources.

The feature validator supports the field families currently used by valid CHS
service definitions and selected builder templates. Unsupported executable fields
report the source service and field. Native mode intentionally rejects external
resources, custom IPAM, arbitrary network/volume options, remote contexts and
arbitrary Compose Watch actions. Legacy `.touch` rebuild metadata is accepted;
Reload remains explicit.

## Validation

Run the ordinary checks without Docker:

```sh
npm run typecheck
npm test
npm run build
```

Run public-image Docker tests (fixtures use exact service names too; ensure names
such as `app`, `db` and `seed` are free). The test scripts run fixtures serially to
avoid name collisions:

```sh
# Ensure these images are present before running the fixtures.
docker pull alpine:latest
docker pull maven:3.9-eclipse-temurin-21
docker pull node:24-bookworm
npm run test:docker
```

These exercise dependency gates, jobs, no-op applies, targeted updates, stop/start,
separate Compose/native volumes, Java compilation jobs, Node builds/reloads and
file-backed secret mounts. Unit tests additionally cover lost create responses,
foreign ownership, job failure/retry, cancellation, private output and stale plans.

Optional CHS infrastructure tests require `mongo:8.2.5-noble`, `traefik:v3.6.2`, `bitnamilegacy/zookeeper:3`,
`bitnamilegacy/kafka:2`, Alpine and Node images already available locally:

```sh
npm run test:docker:chs
npm run test:docker:platform
```

The platform test pulls `alpine:3.22` for `linux/amd64` and checks execution. CHS
infrastructure fixtures use temporary checkouts, isolated volumes
and a dynamically assigned loopback ingress port. They require their service names
(including `mongo`, `kafka` and `ingress-proxy`) to be free on the engine; conflicts
fail safely. Run combined fixture invocations with `--test-concurrency=1`.
Cleanup targets their own resources only. They do not start or modify the developer's CHS checkout.

Passing these fixtures establishes the infrastructure and representative development
contracts. It does not claim acceptance of every private CHS application, a fresh
interactive ECR/SSO login, or real repository-specific SSH builds.

## Verification record

The implementation was checked on Docker Desktop 4.55.0, Docker Engine 29.1.3
(API 1.52, using negotiated API 1.47) and Compose 2.40.3-desktop.1 on Apple silicon.
The automated fixtures passed for native/Compose data isolation, Java and Node
development, the existing CHS Mongo and Kafka script runner, Traefik routing and
discovery isolation, anonymous-volume reuse, and AMD64 execution. These are isolated
acceptance fixtures, not a claim that every CHS application has been exercised.

The Apple acceptance suite passed all five scenarios on Apple CLI/service 1.5.0
and macOS 27.0.1 on 1 October 2026. Ingress was exercised from inside the container
network (`CHS_APPLE_GUEST_HTTP=1`); standalone host HTTP connections timed out on
this machine, so host published-port access remains unverified here. The runtime's
179 unit tests, compiler parity checks, Docker regression suite, formatting and
TypeScript build passed. No private ECR login or full private application-module
acceptance was claimed. The temporary Apple test engine was stopped and removed.
