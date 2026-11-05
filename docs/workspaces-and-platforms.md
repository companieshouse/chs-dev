# Workspaces and platforms: RAND-740 and RAND-741

This is a local source investigation, not a platform certification. The supported
operating model remains **one active checkout and one operation owner**. No Docker,
remote host, cloud provider or Windows/ARM machine was contacted for this spike.
Paths below refer to the current `chs-dev` and adjacent
`docker-chs-development` checkouts.

## Worktrees

A worktree can be selected as the single active project. Stop the current
installation and finish cleanup before switching the configured project path;
inspect the resulting state before applying the next checkout. Do not assume a
second shell or a different current directory selects a different environment.
The project picker recognizes worktree `.git` files and their `commondir`
([discovery](../src/project/discovery.ts), [fixture](../test/project-search.test.ts)).
That proves origin discovery, not branch tracking or concurrent operation. A
linked worktree has its own HEAD and normally cannot check out a branch already
checked out in another worktree; detached HEAD and renamed branches must not be
used as persistent environment identity. Worktree discovery can miss a checkout
outside the search bounds, below an already matched checkout, or behind a symlink;
an explicit path is needed in those cases.

The settings and daemon identity derive from XDG settings/state paths, not the
working directory or branch ([settings](../src/infrastructure/settings.ts),
[daemon discovery](../src/daemon-control/discovery.ts)). Project state and
prepared operations are separated by a hash of the canonical checkout path
([settings](../src/infrastructure/settings.ts),
[preparation](../src/project/preparation.ts)), but this does not isolate the
shared daemon, proxy, engine, or published ports. Compose identity uses
`COMPOSE_PROJECT_NAME`, then project `.env`, then Compose `name`, then a
sanitized checkout basename; it is not inherently unique
([prepare](../src/project/prepare.ts)). Compose commands supply the name and
canonical project directory; container inspection requires matching project and
working-directory labels ([runtime](../src/infrastructure/live-runtime.ts)).
These ownership checks reduce accidental selection, but do not prevent Docker
name or port collisions before selection, or prove safe removal of all resources.

The adjacent service definitions include fixed container names, fixed published
ports such as Mongo 27017, named data volumes, and scripts using the Docker
socket or hard-coded container names
([Mongo](../../docker-chs-development/services/infrastructure/mongo.docker-compose.yaml),
[Elasticsearch](../../docker-chs-development/services/infrastructure/elasticsearch7.docker-compose.yaml)).
The daemon proxy binds port 80; generated routed-service ports are deterministic
from service names and only collision-checked within one generated document
([proxy service](../src/server/proxy-service.ts), [prepare](../src/project/prepare.ts)).
Changing Compose project name alone therefore cannot enable concurrency.
Development sources are `repositories/<service>` under the chosen project;
an existing directory is used as-is, while the branch label only affects an
initial clone ([prepare](../src/project/prepare.ts)). A project worktree does
not automatically create or switch service repository branches. Service, mock,
lazy and version selections must be evaluated in that selected checkout; there
is no evidence here that switching preserves or isolates all their runtime state.

For a future simultaneous-worktree feature, assign an explicit persistent
workspace ID independent of branch and path, recording canonical path and Git
common directory separately. Use it for daemon/session ownership, generated
artifacts, Compose project and resource labels; resolve fixed container names,
external networks/volumes and all host ports, including ingress, before enabling
concurrency. Share immutable image layers and content-addressed caches only;
keep writable database volumes, service source trees, configuration, secrets and
runtime state private unless explicitly designed for sharing. Cleanup should
preview exact labeled resources, refuse ambiguous ownership and preserve shared
images/caches and volumes by default. Handle moved/deleted worktrees and stale
resources explicitly; never infer ownership solely from a branch or project name.

Follow-up local acceptance: fixture two worktrees including a `.git` file,
detached HEAD, path move and same basename; assert distinct stable IDs, daemon
state and prepared paths; compile representative fixed-name/port/socket/volume
definitions for both and assert no overlapping mutable resources; exercise
Service/Development/Mock, version pins, lazy traffic and independent stop/cleanup
through injected engine responses. Verify refusal on missing/conflicting labels,
partial cleanup and stale entries. This is proposed work, not present behaviour.

## Development containers

Recommend first evaluating a **tool-only container connected to the host-owned
daemon**, keeping the stack and proxy on the engine host. This preserves one
operation owner and avoids treating a container's loopback as the engine host.
It is a proposed integration, not a currently supported configuration. A CLI/TUI
client must reach the daemon's private Unix socket with compatible UID, filesystem
permissions and protocol; settings-derived socket paths must agree in both
namespaces. The existing socket directory and socket have ownership/permission
checks ([API](../src/server/api.ts)); mounting an arbitrary host socket or sharing
host settings does not guarantee these checks or matching paths. A mixed host and
container client must connect to the same owner and see the same canonical project
paths; a protocol mismatch is rejected. Container-local paths supplied as project
paths may not exist for the host daemon.

Running the daemon and Docker CLI inside the tool container is a different,
higher-risk option: Docker bind mount sources are interpreted by the engine host,
while preparation emits absolute paths from the daemon's namespace
([compose paths](../src/project/compose.ts)); prepared Compose files and service
repositories must be visible under matching host paths. The daemon resolves
published upstreams through its own `127.0.0.1`, whereas the engine publishes
ports on its host. The generated retarget for retired ingress uses
`host.docker.internal` ([prepare](../src/project/prepare.ts)); its resolution and
reachability to the actual proxy are not guaranteed on every engine. A remote
Docker endpoint adds the same path and loopback mismatch. `DOCKER_HOST`,
`DOCKER_CONTEXT` and `DOCKER_CONFIG` are captured at daemon startup
([environment](../src/daemon-control/environment.ts)); container management
pins the selected context when neither endpoint variable is set
([Docker client](../src/infrastructure/docker-containers.ts)). Changing a later
client's environment does not move the existing daemon to that engine. Docker
socket access grants substantial control over the engine host and its mounts.
Docker-in-Docker adds a second engine, image storage and networking and is not
the recommended first proof of concept.

A small follow-up should define an explicit socket/path mapping and user identity,
pin Node and required CLI versions, keep credentials out of the image, and test
interactive TUI, logs, cancellation, debugging/port forwarding and upgrades.
Use temporary settings and fake local socket/engine endpoints to prove mixed
clients share a single session, reject incompatible protocol and mismatched
paths, and verify generated bind sources, endpoint selection and host-proxy
routing. Include Service, Development, Mock, lazy startup and selected versions;
exercise expired/missing authentication without copying credentials into logs.
SSM is a separate provider follow-up and its availability cannot be assumed.
These injected tests do not establish actual engine networking or host mounts.
Live host/engine combinations, terminal behaviour, permissions, authentication,
performance, resource consumption and cleanup remain unverified.

## Platform and remote boundaries

- macOS installs a per-user launch agent by default; other platforms use a
  detached on-demand daemon ([discovery](../src/daemon-control/discovery.ts),
  [launch agent](../src/daemon-control/macos/launch-agent.ts)). Detached mode
  does not itself restore the daemon after reboot. Proxy port 80 availability,
  host reachability and engine integration require platform validation.
- Native Windows is not established: the implementation assumes Unix sockets,
  `/tmp`, `/dev/null`, POSIX ownership and signals. WSL is a more plausible
  Linux environment, but its filesystem performance, Docker endpoint, socket
  permissions, port forwarding, proxy reachability, authentication and startup
  across Windows/WSL restarts remain unverified. Test with WSL paths and engine
  integration explicitly; do not infer support from a Linux fixture.
- ARM support requires image publishers to supply suitable manifests and service
  owners to validate native or emulated execution. The tooling can surface image
  and container platform information, and version data may carry ECS architecture
  ([containers](../src/domain/containers.ts),
  [versions](../src/infrastructure/cidev-versions.ts)); that is not evidence that
  every image has an ARM variant. Follow up with injected manifest/platform
  diagnostics for missing variants and explicit emulation messaging; test real
  image availability and performance separately.
- Remote developer environments and dotfiles need an owned design for machine
  provisioning, configuration sync, secrets, access, routing, data and teardown.
  A dotfiles repository alone does not make remote Docker paths or ingress work;
  no remote environment or configuration synchronization is implemented here.

Local verification on 2026-11-05: `node scripts/test-local.mjs
 test/project-search.test.ts test/project-preparation.test.ts` passed 29 tests,
with no skips. These cover discovery and preparation fixtures, including name
precedence, per-checkout state, repository reuse and generated proxy targets;
they do not prove simultaneous environments or live platform compatibility.
