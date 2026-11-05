# Daemon operation and API

Launching `chs-dev` without arguments or `npm run dev` connects to the existing daemon. On macOS,
the first launch installs and bootstraps a per-user LaunchAgent so the daemon also
starts at login. Clean established intent can resume after a login or reboot when
the canonical checkout and supported local Docker engine identity still match. Closing the TUI leaves accepted work and supervision running.

```sh
chs-dev daemon status
chs-dev daemon start
chs-dev daemon restart
chs-dev daemon stop
chs-dev daemon install
chs-dev daemon uninstall
```

For a built checkout use `node dist/entrypoints/chs-dev.js daemon <action>`.
`install` refreshes the macOS login service's executable, package path and startup
environment; it refuses to interrupt active work. Use it after moving the package,
changing the Node installation, or intentionally changing startup overrides.
The service stores absolute paths; its package and Node installation must remain
available at login. Dependencies include native `fs-ext` and `node-pty` modules;
install with npm lifecycle scripts enabled and rebuild after a Node ABI change.

`stop` stops supervision and running daemon commands, but leaves containers alone.
Use **Stop environment** in the TUI to stop/remove containers while retaining
volumes. Environment Stop blocks new cold starts and aborts active work immediately,
then waits for its stopped-intent checkpoint before issuing cleanup. A checkpoint
failure leaves cleanup unissued and reports an incomplete Stop; repair storage
and restart the daemon before retrying. Completion is
verified against observed owned containers; partial cleanup retains its failure
and remaining-container count.

`stop` unloads the LaunchAgent for the current login. `uninstall` also
removes its plist. Starting a frontend can install/start it again. `restart` waits
for shutdown before starting the replacement; interrupted work is not replayed.
Linux can run a foreground or detached daemon but has no service installer.

For development, stop an existing service before running `npm run server` in the
foreground. To use a detached process without installing a login service, set
`CHS_DEV_DAEMON_MODE=detached` consistently for the frontend and daemon-control
commands. Tests use this mode with isolated XDG directories and socket paths.

Settings remain in `~/.config/chs-dev/tui.yaml` or the existing XDG override.
Daemon checkpoints, operation history and redacted diagnostic logs live under
`$XDG_STATE_HOME/chs-dev/daemon` (default `~/.local/state/chs-dev/daemon`). Prepared
artifacts and backend metadata stay in the existing per-project state directories.
Startup failures are available in `daemon/startup-error.txt`. The Logs tab queries
the daemon's diagnostics. No raw terminal input/output is added to diagnostic logs.

Socket discovery derives a short path beneath a private `/tmp/chs-dev-UID-HASH/`
directory using the configuration/state location. `CHS_DEV_SOCKET` overrides it;
its parent must be private and user-owned. One kernel lease per state directory
prevents competing daemon processes, even with different socket overrides.
Protocol mismatches report an error instead of terminating an active daemon.

Environment overrides belong to daemon startup. An already-running daemon keeps
its existing overrides when another shell connects. Review Config to change shared
settings; if an environment variable pins a value, update the login service's startup
environment with `install`. Relative `CHS_DEV_PROJECT` values are resolved at launch,
before a background process changes directory.

## Applied proxy policy

Apply writes resolved lazy/reclaimable policy and generated dependency names into
container metadata. The proxy reads that applied metadata, including stopped
lazy containers, so saving a journey, provider, start mode or route does not alter
routing before Apply. Repeated reads retain stopped-service routes. Historical
deselected labels cannot authorize warm traffic or cold starts.

Existing containers with missing or unsupported lifecycle metadata report an
instruction to Apply configuration. The proxy never reconstructs that policy from
pending saved files. Generated Compose dependencies keep their original readiness
and completion conditions; metadata records their names for lifecycle protection.

## Recovery

The daemon shares one Docker connection across Compose, status and container
inspection, exact-container controls and proxy routing. Startup Docker selector
and TLS settings are frozen; project credentials are resolved separately. For
local `unix://` and `npipe://` endpoints, a context is resolved to its actual
endpoint and recovery compares that endpoint plus Docker's observed engine ID.
Changing the shell's context cannot redirect an existing daemon's local operations.
Remote/TLS/context-held transports retain existing explicit use, but have no
automatic recovery identity or immutable-endpoint guarantee. Restart the daemon
to change its startup connection inputs.

Checkpoints retain only established intent, the canonical checkout, engine
fingerprint, applied logical membership and manual holds. Merely observing existing
containers never adopts them, including after repeated daemon restarts. A clean
matching checkpoint restores from verified immutable applied Compose artifacts. Recovery does not prepare fresh
configuration or refresh image metadata; Compose image build/pull are disabled.
Applied dependency/init jobs, including existing Development builder containers,
can run according to Compose health/completion conditions. Current generated helpers
are retained;
historical deselected roots and orphan helpers are not resumed. Empty applied
membership is an intentional empty environment, distinct from legacy missing
membership. A missing/changed identity or missing legacy membership requires an
explicit Start or Apply.

Before admitting traffic, clean stopped/manual-held intent re-stops any owned
containers revived by engine restart policies such as `restart: always`. Clean
running intent resumes stopped eager roots and leaves lazy roots demand-driven.
The daemon verifies final observations before reporting restoration success.
Interrupted/switching checkpoints and a failed latest accepted Environment Stop
restore a paused/stopped gate with **no automatic engine mutations**, including
cleanup. Inspect those containers and Start, Apply or Stop explicitly; interrupted
work is never replayed. Warm traffic obeys the same intent and applied membership
as cold starts.

This reconciliation occurs at daemon startup or when an initially unavailable
engine becomes available. If Docker alone restarts while the same daemon stays
alive, revived containers are observed rather than automatically re-stopped.
Traffic and cold starts still respect holds; use explicit Stop or clean daemon
recovery to stop revived containers. Probes remain read-only.

Active HTTP requests and streams protect their root and applied dependencies from
idle unload. Mock callback delivery is separately bounded to ten seconds; it is not
an arbitrary background-job lease.

If Docker is unavailable at startup, the durable eligible checkpoint remains
pending. The API remains available during recovery; shared progress reports
“Restoring applied environment…” and Environment Stop can preempt it.
The existing observation schedule retries the bounded read-only identity
check; no recovery mutation occurs before it matches. Rejected service requests
preserve that checkpoint. Explicit Environment Start/Apply/Stop supersedes pending
recovery; Cancel abandons pending automatic resume authority. A recovery mutation first writes an interrupted checkpoint, so a crash
during restoration cannot cause automatic replay on the next daemon start.

## Local protocol

HTTP/JSON and SSE run over the Unix socket. The typed contract is in
[`src/protocol/types.ts`](../src/protocol/types.ts), runtime validation in
[`schemas.ts`](../src/protocol/schemas.ts), and the reusable client in
[`src/client/`](../src/client/).

| Endpoint                          | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `GET /v1/session`                 | Current snapshot and protocol version                               |
| `GET /v1/events`                  | Snapshot then ordered state/log deltas; supports `Last-Event-ID`    |
| `POST /v1/commands`               | Accept a validated command; return HTTP 202 and an operation        |
| `GET /v1/operations/:id`          | Follow accepted work independently of the submitting connection     |
| `POST /v1/operations/:id/cancel`  | Explicitly request cancellation                                     |
| `POST /v1/queries`                | Read containers, logs, configuration, profiles or project discovery |
| `POST /v1/logs/stream`            | Private engine/environment log stream; disconnect aborts readers    |
| `GET /v1/interactions/:id`        | Claim an exclusive private terminal stream                          |
| `POST /v1/interactions/:id/input` | Input/resize using the returned claim token                         |

Commands contain `protocol`, `clientId`, `requestId`, `scope`, `command` and `args`.
`scope` contains the current checkout path and session generation. Queries also
carry scope; they never launch mutations. Errors have a stable `code`, a human
`message` and an `operationId` where relevant. Important codes include
`STALE_PROJECT`, `CONFIGURATION_CONFLICT`, `SETTINGS_CONFLICT`, `BUSY`,
`INTERACTION_CLAIMED`, `PROTOCOL_MISMATCH` and `INTERRUPTED`.

Use a stable request ID when retrying an uncertain command response. Retrieve the
returned operation instead of submitting a new command. Deduplication is retained
with the bounded operation history; it is not an exactly-once guarantee against
external engine side effects. A disconnected client can reconnect and observe
accepted work; cancellation requires an explicit request.

The TUI and [CLI](cli.md) share this client library. Socket protocol version 5 removes runtime selection and Apple engine startup.
Matching frontend/daemon versions are required. Earlier protocol changes added
legacy configuration edits, startup approval, configuration/preview queries,
dependency diagrams and log streaming. Environment failures and blocked starts
produce failed operations; accepting work does not guarantee its success.

## Verification

```sh
npm run typecheck
npm test
npm run build
python3 test/login-terminal.py
npm run format:check
```

Unit and daemon tests use temporary state, fake engines and real Unix sockets.
Terminal tests run the TUI with fake AWS/registry tools. Crash tests kill isolated
helper processes and check that their child commands terminate. LaunchAgent tests
validate generated configuration without installing a service in the user's account.
Compose integration suites remain opt-in; they require Docker and Docker Compose.
Run `npm run test:docker` for lifecycle/container controls and
`npm run test:docker:mocks` for mock providers. Recovery evidence is fixture-based:
`daemon-recovery`, `service-actions-applied`, `docker-connection` and `daemon-proxy`
cover engine/checkout gates, pending writes, cancellation, generated dependencies,
immutable artifacts and reachable HTTP upstreams. No real host reboot, LaunchAgent
installation or live-engine business workflow was executed for these tests.
