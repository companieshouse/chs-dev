# Command line interface

`chs-dev` opens the TUI without arguments. With arguments it runs a CLI command
against the same per-user daemon and selected checkout. Both interfaces share
configuration, operations, health monitoring and runtime adapters.

```sh
npm install
npm run build
node dist/entrypoints/chs-dev.js --help
node dist/entrypoints/chs-dev.js status --json
```

For development, use `npm run dev -- <command>`. To expose the built executable on
your PATH, run `npm link` in this package. This gives the package ownership of the
`chs-dev` command, including when a legacy installation already supplies that name.
Rebuild after changing source. The package requires Node.js 22.18 or later.

## Commands

```sh
chs-dev                                      # TUI
chs-dev --help
chs-dev --version
chs-dev status
chs-dev start --yes
chs-dev apply --yes
chs-dev stop
chs-dev logs --tail 200
chs-dev service list
chs-dev service show accounts-api
chs-dev service configure accounts-api --enabled true --development true
chs-dev service configure accounts-api --exclude dependency --allow other-dependency
chs-dev service mocks
chs-dev service mocks company-profile-api
chs-dev service configure company-profile-api --enabled true --provider mock --scenario success
chs-dev service configure company-profile-api --scenario not-found
chs-dev service configure company-profile-api --provider service
chs-dev environment source cidev
chs-dev environment source staging
chs-dev service configure company-profile-api --version-source live
chs-dev service configure company-profile-api --version-source latest
chs-dev environment export ./team-environment.yaml
chs-dev environment diff ./team-environment.yaml
chs-dev environment import ./team-environment.yaml --yes
chs-dev environment versions cidev
chs-dev environment versions cidev --yes
chs-dev environment measure
chs-dev environment measure --journey accounts
chs-dev journey list
chs-dev journey start accounts
chs-dev journey start accounts --yes
chs-dev cache clear
chs-dev service start accounts-api other-service
chs-dev service stop accounts-api
chs-dev service restart accounts-api
chs-dev service reload accounts-api
chs-dev service logs accounts-api --tail 200
chs-dev daemon status
chs-dev daemon start
chs-dev daemon stop
chs-dev daemon restart
chs-dev daemon install
chs-dev daemon uninstall
chs-dev daemon logs --tail 200
chs-dev operation list
chs-dev operation show OPERATION_ID
chs-dev operation wait OPERATION_ID --timeout 60
chs-dev operation cancel OPERATION_ID
```

Run `chs-dev <command> --help` for its flags. Recent-output commands accept tails
between 1 and 5,000, defaulting to 200. `logs` reads retained environment operation
output; `daemon logs` reads redacted daemon diagnostics; `service logs` reads the
selected service's container output. Use legacy streaming logs to follow output.

Reads are passive: they do not start a stopped daemon. `status` and `daemon status`
successfully report that it is stopped; other reads report `DAEMON_UNAVAILABLE`.
Environment, service and configuration mutations start the daemon if needed.
Daemon lifecycle commands explicitly control the daemon. `stop` stops/removes
the environment's containers and keeps volumes; `daemon stop` stops daemon work
and supervision and leaves containers alone.

The new CLI uses the daemon's selected checkout. A connected shell cannot change
its project or pinned settings through environment overrides. Differences
produce warnings. Select a different checkout in the TUI or update daemon startup
settings as described in [daemon operation](daemon.md).

## Waiting, approval and automation

Service mode follows a global version source, defaulting to CIDEV, with optional
per-service environment, latest or image pins. See [service versions](service-versions.md).
`environment source` saves the default source pending until Apply or Start.
`service configure --version-source default` clears a service override and image pin.

See [environment files and CIDEV versions](environment-profiles.md) for sharing
enabled services, providers and mock scenarios, or copying versions only.
Profile import and CIDEV copying preview by default; `--yes` saves local changes
pending until an explicit Apply or Start, preserving pending changes across restarts.

Mutations wait for their operation by default. `--detach` returns the accepted
operation ID and leaves execution in the daemon. `--timeout SECONDS` limits the
client wait; zero means no deadline. Timeout, Ctrl+C and SIGTERM disconnect the
client while accepted work continues. Only `operation cancel ID` explicitly
cancels it. Daemon lifecycle commands do not accept `--detach`.

Startup asks for confirmation only when its plan would stop running services
outside saved configuration. Interactive text commands display the plan and can
prompt. JSON, piped and detached commands require `--yes` for such a plan and
otherwise return `CONFIRMATION_REQUIRED` with the plan and revision. Detached
startup without `--yes` performs a read-only preview before acceptance; the daemon
still checks actual state during execution. With `--yes`, the daemon owns approval
and execution, so a detached client need not stay connected.

`service configure` preserves omitted fields and stages saved configuration. It
reports configuration saved and application `pending`; success of that save does
not change running containers. Use explicit `apply` to wait for reconciliation.
Ordinary Apply preserves manual stops; service Start releases one, and Environment
Start releases all manual stops.

Providers are `service`, `development`, and `mock`. Development requires a builder;
Mock requires a contract in this repository's `mocks/` catalogue. `--development`
remains supported; it must agree with `--provider` when both are supplied.
`service mocks [SERVICE]` lists available scenarios. `--scenario` changes an already
selected mock provider, or can accompany `--provider mock`. The last scenario is
remembered when switching providers. See [mock providers](mock-providers.md) for
dependency behaviour, routing and adding contracts.

`--json` emits one JSON document on stdout. New commands use this envelope:

```json
{
    "version": 1,
    "ok": true,
    "command": "start",
    "data": { "accepted": true },
    "warnings": [],
    "operation": {
        "id": "operation-uuid",
        "state": "queued"
    }
}
```

The operation above is abbreviated; records also contain kind, scope, request/client
IDs and timestamps. Errors have `ok: false` and an `error` with `code`, `message`
and optional `data`. Successful legacy compatibility queries retain their original
JSON payloads below. Legacy errors use the envelope. Text diagnostics go to stderr;
JSON warnings stay inside the envelope; successful legacy JSON queries send
warnings to stderr to preserve their payloads. No prompt is emitted in JSON mode.

```sh
chs-dev start --yes --detach --json
chs-dev operation wait OPERATION_ID --timeout 120 --json
chs-dev operation cancel OPERATION_ID --json
```

| Exit      | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| 0         | Successful read, completed mutation or accepted detached work           |
| 1         | Execution, connection, cancelled/interrupted operation or other failure |
| 2         | Invalid command, arguments or unsupported flags                         |
| 3         | Startup confirmation required                                           |
| 124       | Client wait timed out; accepted work continues                          |
| 130 / 143 | Client interrupted by SIGINT / SIGTERM; accepted work continues         |

## Legacy compatibility

Compatibility follows the pulled `main` branch of `~/Workspace/chs-dev`, version
4.0.0, commit `0c66000ed6257d626c42d04493e6651566709fa4`. The implementation uses
daemon commands and queries throughout; it does not run the legacy executable.
Both space-separated and colon-separated topic syntax work:

```sh
chs-dev legacy services available --json
chs-dev legacy services:enable accounts-api other-service
chs-dev legacy services disable accounts-api
chs-dev legacy modules available --json
chs-dev legacy modules enable module-name
chs-dev legacy modules disable module-name
chs-dev legacy development services --json
chs-dev legacy development enable accounts-api
chs-dev legacy development disable accounts-api
chs-dev legacy exclusions list --json
chs-dev legacy exclusions add accounts-api -d
chs-dev legacy exclusions remove accounts-api -d
chs-dev legacy exclude accounts-api               # alias for exclusions add
chs-dev legacy include accounts-api               # alias for exclusions remove
chs-dev legacy up --yes
chs-dev legacy down
chs-dev legacy reload accounts-api
chs-dev legacy status --json
chs-dev legacy logs accounts-api other-service -f -n 100
chs-dev legacy logs -C -f -n 0
chs-dev legacy dependency service accounts-api -t tree
chs-dev legacy dependency service accounts-api -t flattree
chs-dev legacy dependency service accounts-api -t diagram
chs-dev legacy dependency system
```

Legacy commands target `CHS_DEV_PROJECT`, or the current working directory when
unset. Paths are canonicalized. A running daemon selected on another checkout
returns `PROJECT_MISMATCH`; it does not silently switch. Legacy reads remain
passive. A legacy mutation can start a stopped daemon on its target checkout.

Legacy edits update the four independent selections in `.chs-dev.yaml`: `modules`,
`services`, `servicesWithLiveUpdate`, and `excludedServices`. Disabling a service
removes its explicit root selection; a module or another service can still require
it. Use exclusions to prevent that service from being enabled. Disabling a service
does not remove its development selection. Enabling development requires an
enabled service with a supported builder. The available development list uses
daemon builder support, which can be narrower than the old repository-based list.
Required infrastructure cannot be disabled or excluded.

Each batch validates all names before one atomic YAML save. Comments and unknown
keys are retained. All saves remain pending across daemon restarts until Apply or
Start, including later ordinary service saves and external edits. `legacy up`
applies saved state using current daemon
preparation; it shares its clone/pull timing. Reload uses the daemon's current
development rebuild semantics and rejects pending saved changes with an instruction
to Apply them first.

Exclusions `-d` affects direct dependencies and retains dependencies still required
by other enabled services. Streaming logs support multiple services, `-C` for
retained environment operation output, `-f` to follow, and `-n all` or a nonnegative
tail. Zero starts without history. Docker streams actual engine output;
disconnecting terminates their owned log processes. Streaming output is text and
does not accept `--json`. Environment output is bounded in-memory history, so
`-C -n all` means all retained lines. Streams stay on the containers selected when
opened; reopen after services are recreated.

Dependency diagrams require Graphviz. They are SVG files in the project's private
state directory and return their paths. Text commands in an interactive terminal
also open them; JSON and piped commands only return paths.

Successful compatibility query shapes are:

```json
{ "services": ["accounts-api"] }
{ "modules": ["module-name"] }
{ "exclusions": ["excluded-service"] }
{
    "modules": ["module-name"],
    "services": [
        {
            "name": "accounts-api",
            "composeStatus": "Running",
            "liveUpdate": false,
            "transient": false
        }
    ]
}
```

`services available` and `development services` share the first shape. In legacy
status, `transient` means enabled without an explicit `services` root. Runtime
status maps a stopped/missing container to `Not running`; other states use daemon
Docker health vocabulary.

Builder-version/pull-control flags, reload `--force`, down volume/image-removal
flags, and up telemetry/environment override flags are rejected before connecting
to the daemon. State save/restore, troubleshoot, sync, autocomplete, removed
deprecated aliases and feature-branch mocks commands are outside this initial
compatibility scope and return usage errors.

## Protocol and verification

CLI envelope version 1 is separate from Unix-socket protocol version 5. Existing
older daemons need an explicit restart after their work finishes; clients
report a version mismatch and do not replace a working daemon automatically.
Old auto-apply settings and checkpoint deferral fields are ignored. The snapshot
`live.autoApply` compatibility field is always false; settings expose retirement
warnings for `autoApply` and `CHS_DEV_AUTO_APPLY`.

`npm test`, `npm run check` and `npm run build` cover command parsing, Unix-socket
dispatch, legacy selection semantics, atomic saves, staged configuration/restarts, confirmation,
detachment, cancellation, wait deadlines, log streaming and architecture boundaries.
Compose lifecycle, container-management and mock-provider integration suites
remain opt-in and require Docker with Compose. See the
[transition guide](compose-transition.md) before upgrading an existing native environment.
