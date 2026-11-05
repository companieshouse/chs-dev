# Architecture

chs-dev is one TypeScript/npm package with a persistent local daemon and an Ink
frontend and a CLI. The daemon owns one active checkout and all external operations. Closing
a frontend disconnects it; accepted work, health checks and authorised supervision
continue. One public `chs-dev` executable opens the TUI without arguments and
dispatches CLI commands otherwise.

```text
src/
  entrypoints/
    chs-dev.ts              Public argument/TUI dispatcher
    tui.tsx                 Interactive frontend
    server.ts               Foreground daemon
    daemon-control.ts       Service installation and lifecycle commands
  server/
    bootstrap.ts            Construct the application and its infrastructure
    api.ts                  Private Unix socket, HTTP/JSON and event streams
  application/
    project-session.ts      Active checkout, settings, commands and switching
    live-controller.ts      Existing environment lifecycle and apply queue
    operations.ts           Durable acceptance, deduplication and cancellation
    interactions.ts         Exclusive terminal claims and private input
    supervisor.ts           Independent observation and probe schedules
    ports.ts                Injected application dependencies
  domain/                   Runtime contracts and pure service/configuration rules
  project/                  Checkout discovery, catalog, YAML and preparation
  infrastructure/           Engines, credentials, files, processes and state
  protocol/                 Versioned DTOs, errors and request validation
  client/                   Typed commands, subscriptions, reconnect and terminals
  cli/                      Command registry, parsing, daemon client and output
  tui/
    app.tsx                 Navigation and modal ownership
    context.tsx             Shared client and reactive session snapshot
    hooks/                  Frontend subscriptions and on-demand queries
    models/                 Pure navigation and presentation models
    components/             Screens, editors and terminal handover
  daemon-control/
    discovery.ts            Find or start the daemon
    environment.ts          Explicit startup inputs and mismatch reporting
    macos/launch-agent.ts   Per-user macOS login service
```

`src/index.tsx` preserves the previous launch path. There is no separate published
server package. Architecture tests prevent the TUI and CLI from importing
filesystem/runtime/application implementations and prevent the
application and protocol layers from depending on React or the transport server.
Existing infrastructure adapters retain their established settings accessors; the
application itself receives an explicit `ApplicationHost` and a replaceable backend.

## Commands and snapshots

`Client` connects over a private Unix socket. The parent directory is user-owned
with mode 0700; the socket is 0600. The server rejects browser-origin requests,
validates incoming commands, limits JSON requests to 1 MiB and negotiates protocol
version 5. There is no TCP listener or remote access.

The initial snapshot includes the active checkout, generation, settings and
configuration revisions, runtime capabilities, AWS state, containers' service
status, environment progress and recent operations. The TUI keeps navigation,
filters, selections and unsaved drafts locally. React hooks subscribe to the client
store; they do not instantiate controllers or run engine commands.

Mutations carry a client ID, request ID, checkout and generation. Command acceptance
and a keyed fingerprint are durably written before execution. A repeated request
from that client returns the original operation; changing its payload fails.
Arguments, including SSH passphrases, are not persisted. History retains up to 500
terminal operations plus active work; deduplication applies within that retained
history. Clients should retain the returned operation ID.

The operation completes independently of its HTTP connection. Explicit cancellation
signals the operation; closing the TUI does not. Conflicting work returns `BUSY`
with the active operation ID when available. Configuration saves can queue during
an apply; the controller preserves immutable apply inputs, and later edits wait
for the next explicit Apply or Start.
Stop cancels or drains environment work and prevents automatic restart or apply.
Every configuration save stages changes, including external edits discovered by
polling. No automatic-apply timer or special legacy deferral is required. Ordinary
Apply preserves manual service stops.

SSE delivers a full snapshot followed by sequenced state and log deltas. Subscription
flushes pending changes before attaching, avoiding a snapshot/subscription gap.
Replay is bounded to 256 events or 4 MiB. Reconnects outside that window or across a
daemon restart receive a new snapshot. Slow readers are disconnected above a 4 MiB
write backlog. Container logs and private terminal output are separate queries or
streams, never part of replay history. Client reconnection retains local TUI state.

## Settings and checkout changes

Settings retain the existing `tui.yaml` format and precedence: daemon startup
environment, file, then defaults. The Config tab shows provenance. A connecting
frontend's different environment does not silently change the shared session; its
status bar reports conflicting overrides. Login-service installation records
allowlisted tool paths and profile/settings inputs, excluding short-lived cloud
credentials and SSH-agent socket paths.

Service and settings editors submit their opening revision. Saves reject stale
edits, preserve comments and unknown YAML keys, and replace files atomically.
External edits are observed; another external writer can still race the final
comparison and rename. This coordination is between daemon clients, not a global
lock on unrelated tools.

Project changes use one stop-before-reconfigure operation:
validate the destination; checkpoint switching intent; close old interactions; stop
and remove owned containers; verify none remain; close the old backend; save and
activate the setting; open the destination; publish a new generation. Volumes remain
with their original backend. Failed Stop leaves the old checkout selected. Activation
failure attempts to restore the old selection, without starting it. If recovery
fails, the daemon blocks more mutations and reports how to recover.

Requests and confirmation tokens from an old generation cannot mutate the new
checkout. Confirmations include the current plan and configuration revision.
Container actions re-inspect the exact ID and incarnation, then use authoritative
ownership metadata; engine adapters perform their own identity check immediately
before mutation. The All containers view retains its existing controls.

## Lifecycle, health and recovery

`ProjectSession` owns the `LiveController`, backend, schedules and checkout lease.
Status/configuration polling runs every five seconds after a check completes,
health probing every two seconds and AWS observation every thirty seconds. The
schedules do not overlap themselves. Health probes are independent of environment
build/apply work and remain active without frontends.

Docker Compose is the only execution backend. Docker owns container health and
restart policies; the daemon observes actual state and coordinates explicit
operations, configuration application and lazy-service requests. There is no
custom container scheduler, Compose compiler or Apple supervision loop.

Atomic, fsynced private checkpoints retain established environment intent, manual
service stops, applied logical membership, backend, canonical checkout and observed
engine identity. The daemon shares one pinned connection across Compose, proxy,
container controls and status inspection. Clean intent may resume across login or
reboot only on a matching supported local socket endpoint and engine ID, using
verified applied artifacts. Pending source/configuration/version changes remain
inactive. Remote/TLS transports retain explicit use without automatic recovery or
an immutable-endpoint guarantee.

Operations are persisted separately. Startup marks unfinished operations
interrupted; interrupted/switching state and a failed latest accepted Stop require
explicit reconciliation with no automatic engine mutations. Clean stopped/manual
holds re-stop containers revived by engine restart policy before traffic is allowed.
Unavailable Docker defers recovery through bounded read-only identity checks on
the existing observation schedule. Unknown legacy state requires explicit Start or
Apply. Merely observing containers never establishes restart authority. See
[daemon recovery](daemon.md#recovery) for behavior and fixture evidence.

Kernel file leases protect the daemon and active checkout. Their persistent inodes
are never unlinked to claim ownership; process death releases the lease. Unknown
legacy `live.lock` files are reported for review instead of being deleted. A
frontend exit releases neither daemon nor checkout ownership.

Managed external commands use a small process-group guardian connected to the
daemon. Losing that connection terminates the command group, including after a
hard daemon kill, without relying on persisted PIDs that may have been reused.
The guard allows a termination grace period before a forced kill. Detached work
inside an engine remains subject to runtime inspection and explicit recovery.

## Interactions and TUI

The server owns a PTY for login and clone commands. A frontend claims the operation's
interaction, receives a private input token, streams terminal output and forwards
input and resize events. Other frontends see only the safe interaction status.
Only one frontend may provide input. Ctrl+C cancels that operation. A disconnected
terminal claim has a five-second reattachment window; unclaimed interactions time
out after two minutes. Abandonment cancels the entire login flow, including its
non-terminal credential-fetch stages.

SSH setup keeps the existing masked form and managed secret-file implementation;
its input is sent only in the command body. Plan confirmations remain structured
commands. Completing login rechecks checkout identity and controller intent before
resuming work, so Stop or switching cannot accidentally restart the environment.

All tabs, service-to-container navigation, progress, local spinners and terminal
handover remain in the TUI. Daemon state changes appear in every frontend. The
CLI uses `Client.submit`, `wait`, `cancel` and queries without importing Ink or
runtime adapters. Its registry rejects unsupported legacy flags before connection.

See [daemon operation and API](daemon.md) for startup, installation, debugging and
transport endpoints, and the [Compose transition guide](compose-transition.md)
for retiring an existing native environment.
