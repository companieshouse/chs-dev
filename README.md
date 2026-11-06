# chs-dev

A persistent local CHS development daemon with a CLI and an interactive terminal frontend using [Ink](https://github.com/vadimdemedes/ink) and React.

Requires Node.js 22.18 or later, npm, Docker and Docker Compose v2. With no arguments `chs-dev` opens the TUI;
arguments run CLI commands, including `chs-dev legacy …` compatibility commands.

```sh
npm install
npm run dev
npm run dev -- status --json
npm run dev -- start --yes
```

See [CLI commands and compatibility](docs/cli.md) for installation, daemon controls,
automation, exit codes and legacy behaviour. Both frontends operate the same daemon.

Save stages configuration; explicit Apply or Start activates it. Manage private
SSM values with [secret commands](docs/secrets.md). Optional
[operation telemetry](docs/telemetry.md) is disabled until explicitly configured.

Service providers default to **CIDEV** versions. Press **Ctrl+E → v** to choose a
global version source, or use a service's **Versions** row for an environment,
specific version or latest override. See [service versions](docs/service-versions.md).

Share service selections, providers, mock scenarios and image pins with
[environment files](docs/environment-profiles.md), or copy running CIDEV versions
while preserving your local setup. In the TUI, press Ctrl+E then p for sharing.

The TUI connects to one daemon per user, which manages one selected checkout.
On macOS the first launch also installs a login service. Closing the TUI leaves
accepted operations and health monitoring running. Clean restart can restore
applied intent after verifying the same checkout and local Docker engine;
interrupted work stays blocked for explicit reconciliation. Detached mode resumes
only when launched. See [daemon operation](docs/daemon.md) for the recovery
conditions, service controls, startup environment and shared API.

Press `q` outside text/search editing or `Ctrl+C` to exit and return to the shell.
`Esc` never exits the TUI: it clears or leaves an active search, backs out of a
detail view or overlay, or does nothing at an unmodified root screen. Press `?`
on any root screen for the current keyboard shortcuts. Destructive stop/restart
actions and unsaved service edits ask for confirmation.
Switch between Services, Containers, Modules, Enabled, Journeys, Logs, and Config with `Ctrl+N` / `Ctrl+P`
(or Ctrl+Tab / Ctrl+Shift+Tab where supported). Left/right arrows switch tabs
everywhere outside modals. Outside Modules, Tab and Shift+Tab also switch tabs.
Services loads asynchronously after the first screen appears. It reads service names from
Compose YAML under `services/modules/<module>` and groups them by module. Shared services,
including nested infrastructure stacks, appear under Infrastructure. Names are sorted and
deduplicated within each group. Logs shows daemon events and environment output. Config lists and edits the
TUI settings (see [Settings](#settings)). Invalid projects or unreadable service files show an error.

The compact Services table separates saved selections, observed runtime and saved
Service versions. Press `i` for full selected details, including long names and
image references; PgUp/PgDn pages through the list. All seven tabs fit at 80 columns.

- Enabled reads `.chs-dev.yaml` at startup, including module selections, transitive
  dependencies, and exclusions. Base infrastructure is included. A missing state file
  means no optional services are selected; an invalid state file shows Unknown.
- Mode shows the selected Service, Development or Mock provider. Mock contracts and
  scenarios live in this repository under `mocks/`; saved scenarios appear in
  selected details and may still be pending Apply. Mocked services omit their real dependencies and route to Microcks.
  Existing `servicesWithLiveUpdate` settings and dedicated mock services remain supported.
  See [mock providers](docs/mock-providers.md) for the catalogue and setup.
- Docker status loads separately and refreshes every five seconds after each completed
  request. Containers are matched by Compose service and project working-directory labels;
  one-off containers and other checkouts are ignored. Running means no reported health
  status; Healthy/Unhealthy come from Docker health checks. No container means Stopped.
  Exit codes are interpreted: 0 without a health check is Completed (one-shot jobs such
  as `execute-mongo-scripts`), SIGTERM and engine-confirmed non-OOM SIGKILL exits are
  Stopped, and other exits are Exited. Exit 137 without OOM evidence stays visible
  as an exit; it does not establish an OOM kill.
  Docker failures show Unknown and retry without blocking navigation. Environment state
  and user intent are checkpointed privately, separately from project configuration.

Use Up/Down to select services and scroll. Press `/` and type to filter service or module
names immediately. Up/Down leaves search and navigates the matches without Enter.
Outside search, press **e** to cycle **All → Enabled → Disabled**. The header shows
the current choice and matching count. This uses configured Enabled values and
combines with the name/module search; services with Unknown configuration appear
only under All.
Escape clears the active search/filter and leaves search editing. Enter finishes
editing while preserving the query. Filters remain when changing tabs until
Escape clears them.
Tab or Left/Right switches tabs and ends search while keeping the filters.

Modules provides a two-panel explorer. Up/Down browses modules and services;
Enter expands or collapses a module. Selecting a service shows its
dependency tree automatically. Tab switches panel focus. Press `d` for Depends on
or `u` for Used by. Left/Right switches tabs from either panel.
Both trees include indirect relationships and mark shared references and cycles.

Enabled shows only configured-enabled services as a dependency tree, grouped by the
module of each root service. Shared dependencies expand once, and cyclic components
remain visible. Disabled/excluded services are omitted. Up/Down scrolls with a centered
selection; Enter opens configuration. The tree refreshes after applying modal edits.
The tree reflects configuration, not which containers happen to be running; each entry
also shows a coloured status dot and the live Docker status (refreshed with the Services
tab), and the header shows the Env summary.
Press `/` to filter module or service names; matching modules expand automatically.
Up/Down leaves search without Enter. Enter on a service in either panel opens the
configuration modal. Scrolling stays centered except at list boundaries.

Press Enter on a service to open its configuration modal. Up/Down selects a row;
Enter or Space toggles Enabled or the supported mode. **Save** writes the changes to
`.chs-dev.yaml` and refreshes the list. Escape or Close asks before discarding
unsaved edits. The modal captures navigation so the background list stays selected.
The Provider row cycles Service, Development (with a builder label), and Mock (with
a checked-in contract). Mock adds a scenario selector and explains dependency
behaviour. Scenario changes take effect without restarting containers when applied.
Base infrastructure cannot be disabled.
Saving stages a pending configuration change until explicit Apply or Start (see
[Environment](#environment)). When the service has a container, the modal also offers
**Restart**, **Stop** or **Start** container and **Show container logs** (last 200 lines,
`r` refreshes). Services running in Development mode also offer **Reload (rebuild from
source)**, which rebuilds the image and re-runs the builder while the environment is
running. Apply pending configuration before reloading, so a rebuild cannot activate
unrelated saved edits. The modal stays usable during the rebuild; progress is shown
in Ctrl+E.

The modal's Dependencies submenu shows a tree of direct and indirect dependencies.
Shared dependencies expand once and subsequent references are marked `(shared)`;
cycles are marked `[Cycle]` and cannot be toggled. Space or Enter
toggles Allowed/Excluded; Up/Down scrolls through longer lists. Allowed removes an explicit
exclusion and lets normal dependency resolution decide whether to enable the service.
Exclusions apply project-wide, including when another service shares the dependency.
Required base infrastructure cannot be excluded. Escape returns to the main modal with
edits still staged; Save saves them together, while Close discards them.

Docker Compose is the only execution backend. For upgrades from native Docker or
Apple containers, follow the [manual transition guide](docs/compose-transition.md).

## Containers

The **Containers** tab lists running and stopped containers from the selected engine.
It defaults to this checkout (including Compose services and builder
jobs). Press **a** to switch to all containers on the engine, **/** to filter by name,
image, service or status, and **Enter** to open the selected container. The list and
open details refresh every five seconds; **r** refreshes immediately.

Container details and their logs fill the terminal window. **Esc** returns from
logs to details, then back to the container list with its filter and selection kept.
The header identifies Details, Inspect or Logs and shows **← Back (Esc)**.

Details include the full container ID, image reference, version/tag or digest, image ID,
status and health, timestamps, exit code, published ports, mounts and networks.
Use **s** to start/stop, **x** to restart, **l** for logs, and **i** for inspection JSON.
Stop and restart actions ask for confirmation before they run.
Up/Down and Page Up/Down scroll the details. Logs show the latest 200 lines with **r**
to refresh. Long log lines wrap to the available width; scrolling and paging count
the wrapped rows. The view adjusts when the terminal is resized.
Inspection hides environment values and credential fields; neither
inspection nor container log output is copied into the TUI diagnostic log.

On **Services**, press **c** on a service or choose **View container details** from its
Enter menu. A single primary container opens directly; multiple replicas or builder
containers appear in a service-filtered list. If no container exists, start or apply
the environment to create it. Escape clears the service filter.

Container controls act on the exact selected ID and never pull images or create
containers. They affect that container only, without service dependency propagation
or readiness waits. Use the environment/service controls for orchestration. Actions
share the environment operation lock; manual stops for this checkout are recorded.
The All containers view also permits actions on containers outside this checkout.
A deleted/recreated container must be selected again before acting on its replacement.

`domain/containers.ts` defines container management separately from environment
operations. `DockerContainerManager` supplies inspection, logs and exact-ID
controls, while Compose handles environment startup and configuration.

## Settings

Settings are stored in `$XDG_CONFIG_HOME/chs-dev/tui.yaml` (default
`~/.config/chs-dev/tui.yaml`), next to the legacy CLI's `inventory.yaml`, which is never
read or changed. Edit them on the **Config** tab: Up/Down selects a setting and Enter
opens its editor. Each value shows where it came from: `env`, `file`, or `default`.

```yaml
version: 1
project: ~/Workspace/docker-chs-development
aws:
  profile: development-eu-west-2
  ecrProfiles:
    - development-eu-west-2
    - shared-services-ecr-eu-west-2-ro
login:
  action: registry # aws | registry | ask (default)
  auto: needed # off | needed (default) | expired
```

Environment variables override the file. Values from the environment still appear on
the Config tab. Saving writes the file, and the page warns that the environment value
stays active until the daemon startup environment is updated. A new frontend shell
does not override an existing daemon.

| Setting            | Environment override                      | Default                                   | Applies     |
| ------------------ | ----------------------------------------- | ----------------------------------------- | ----------- |
| Project directory  | `CHS_DEV_PROJECT`                         | current working directory                 | reconfigure |
| AWS profile        | `AWS_PROFILE` / `AWS_DEFAULT_PROFILE`     | `default`                                 | now         |
| ECR login profiles | `CHS_DEV_ECR_PROFILES` (comma list)       | profiles detected from project registries | now         |
| Ctrl+L login       | `CHS_DEV_LOGIN` (aws/registry/ask)        | ask every time                            | now         |
| Automatic login    | `CHS_DEV_AUTO_LOGIN` (off/needed/expired) | when needed                               | now         |

`autoApply` and `CHS_DEV_AUTO_APPLY` are retired and ignored with warnings. Saved
configuration always waits for explicit Apply or Start. Old settings files remain
readable, and unrelated saves preserve retired keys and comments.

Blank environment values are ignored. File paths must be absolute or start with `~/`.
A relative `CHS_DEV_PROJECT` resolves from the app's working directory; note that
`npm run` uses the package directory. Saves preserve comments and unknown keys, and
use a temporary-file rename. A save is rejected if another client or external edit
changed the revision; close the editor and review the refreshed values. An invalid file or value is reported on the Config tab and
ignored, so defaults apply. Changing the project shows
a stop-and-reconfigure operation. The old checkout must stop successfully before
the selection changes; data volumes are retained. Start the newly selected
environment explicitly. External settings edits are refreshed without switching
the active checkout automatically; select the pending setting to apply it.

The retired `runtime` and `orchestrator` file keys and
`CHS_DEV_RUNTIME` / `CHS_DEV_ORCHESTRATOR` overrides are ignored with warnings.
Remove them when convenient; chs-dev always uses Docker Compose.

**Project picker.** Editing the project searches your home directory in the background
(depth 5; hidden directories, symlinks, `~/Library`, `node_modules`, `vendor`,
`target`, `dist`, `build` and similar trees are skipped). Results appear as they are
found. A directory counts as a checkout only if its Git `origin` is
`companieshouse/docker-chs-development` over SSH or HTTPS; worktree `.git` files are
supported. Choose one with Enter, or:

- **Enter a path manually** accepts `~/` paths and checks the project structure. It asks
  for confirmation if the checkout's origin does not match.
- **Clone into a new location** defaults to `~/Workspace/docker-chs-development` (or
  `~/docker-chs-development` without `~/Workspace`). The parent must exist and the
  target must not. The TUI hands the terminal to `git clone` so SSH prompts are visible,
  then selects the new checkout.

If there is no valid project at startup, the TUI still opens. It shows Config with the
picker open, and other tabs show “No project selected — choose one in Config”. Its
daemon logs go to `$XDG_STATE_HOME/chs-dev/daemon/`
(default `~/.local/state/chs-dev/daemon/`).

**State directory.** Everything chs-dev creates for a project (log, lock and prepared
Compose files) lives in `$XDG_STATE_HOME/chs-dev/projects/NAME-HASH/`, where `NAME` is the
checkout's directory name and `HASH` identifies its real path. Nothing is written to the
checkout for chs-dev's own use.

**ECR login profiles.** The checklist lists every AWS profile with its region. Space
toggles a profile, Enter saves the checked profiles, and `r` returns to automatic
detection. Automatic detection scans the project's `services/` and `local/builders/`
files for `<account>.dkr.ecr.<region>.amazonaws.com` registries. It then matches each
registry to a profile by the account (`sso_account_id` or `role_arn`) and region in
`AWS_CONFIG_FILE` or `~/.aws/config`, preferring the primary profile. Matched profiles
are marked **required** and pre-checked. Registries that no profile covers are listed.
Only profile names, regions and account IDs are read, never credentials.

Select a checkout in Config. `CHS_DEV_PROJECT` can also select one at daemon
startup; it does not change a daemon that is already running.

Validation checks for readable `global.env` and `bin/chs-dev` files, and accessible
`services/modules` and `services/infrastructure` directories. The checkout can have
any directory name. This checks its structure, not whether Docker or services are running.

The UI fills the terminal's alternate screen and resizes with the window, restoring your previous terminal content on exit.
The development command runs TypeScript directly. Restart the daemon after server
source changes with `npm run daemon -- restart`; use `npm run dev:tui` to watch
frontend changes independently. `npm run tui:preview -- 80x24` renders
deterministic fixture frames for narrow-terminal checks. On exit the TUI prints
that the daemon continues monitoring and how to query status.

```sh
npm run typecheck
npm test
npm run build
npm start
```

- `src/entrypoints/` launches the TUI, daemon and service controls.
- `src/server/`, `src/protocol/` and `src/client/` implement local IPC.
- `src/application/` owns operations, checkout sessions and supervision.
- `src/domain/` contains pure rules and engine-neutral contracts.
- `src/project/` handles checkout discovery, configuration and preparation.
- `src/infrastructure/` handles engines, credentials, processes and durable state.
- `src/tui/` contains frontend hooks, models, screens and keyboard handling.
- `src/daemon-control/` discovers the daemon and manages its macOS login service.
- `dist/` contains the compiled application after building.

Saving configuration stages it until Start or Apply. The running environment uses
its applied lazy policy to start called services and unload idle ones. Service
actions and verified clean recovery also use the applied artifacts.

See [architecture](docs/architecture.md) for data flow, input ownership, and extension guidance.

Docker Compose owns dependency scheduling, readiness, images and container
lifecycle. chs-dev prepares configuration and coordinates operations through its
daemon. See the [transition guide](docs/compose-transition.md) for upgrading
from the retired native backends.

The bottom status bar checks AWS authentication asynchronously on startup and every
thirty seconds after each completed check. It uses `aws sts get-caller-identity` with the
configured AWS profile (see [Settings](#settings)), passed
explicitly to the CLI so status checks and login target the same profile. “Session active”
means the current credentials work; it does not claim a separate SSO browser session
or container registry login is active. Expired/missing credentials, missing AWS CLI, profile
configuration errors, and connection failures have distinct labels. Checks time out
after 12 seconds. Observation continues when the TUI exits.

Press `Ctrl+L` outside a modal to log in. By default a dialog offers **AWS + registry
login** (pre-selected) or **AWS login** every time. Tick **Don't ask again** (select the
row and press Enter, or press Space) to save the chosen login as the **Ctrl+L login**
setting; later presses then run it straight away with no dialog. The result appears
briefly in the status bar, and a failure opens the dialog with the details. Set
**Ctrl+L login** back to **Ask every time** in Config (or `CHS_DEV_LOGIN=ask`) to see
the dialog again.

**Automatic login** (Config) starts a login without Ctrl+L:

- **When needed** (default): when starting or applying stops for an AWS or ECR login,
  chs-dev logs in and then continues the operation, including while the Environment
  window is open. Other dialogs defer automatic login until they close.
- **As soon as the AWS session expires**: when the background AWS check reports an expired
  session, and no dialog or operation is in progress.
- **Off**: only Ctrl+L logs in.

An expired AWS session needs browser approval, so an automatic login hands the
terminal to the login command with a line explaining why. It uses the Ctrl+L login (AWS +
registry unless you chose AWS only; ECR failures always use AWS + registry). Each expiry or
block is tried once: a cancelled or failed login is not repeated until credentials are
active again or the environment settles. The Environment panel's
login fixes run the login it needs directly. The two logins are:

- **AWS login** runs `aws sso login --profile <profile>`.
- **AWS + registry login with Docker** runs `l_docker -p <profile> [-p <profile> …]`, once for each
  ECR login profile, using the installed `~/.ch_dev/bin/l_docker` when available,
  otherwise looking on PATH. The dialog shows which profiles will be used. For this
  project, those are usually `development-eu-west-2` and `shared-services-ecr-eu-west-2-ro`
  (CI build images). `l_docker` still needs `~/.aws/companies_house/dev.config`.

The TUI temporarily attaches its terminal to the daemon-owned command so browser login
instructions and errors remain visible. Ctrl+C cancels login and restores the
TUI. Private terminal output is streamed only to the attached frontend; failures
show a safe result in the login dialog.
A failure returning to the TUI or resuming the environment does not overwrite a successful login result.
After completion, AWS credentials are checked immediately; the command result
stays in the login dialog, separately from AWS status. AWS status is refreshed after login. Closing the dialog preserves the current tab, selection, and filter.
For Docker, registry login requires the existing dev-env-setup helper and a running
Docker daemon. Neither login action installs tools or starts Docker. If starting or applying fails with an ECR
`403 Forbidden` or `authorization token has expired`, the Environment panel names the
registry. It tells you to run **AWS + registry login** and to check the ECR login profiles.

Docker Compose availability appears in the status bar. AWS SSO and registry login
retain their existing profile settings.

## Environment

Press **Ctrl+E** (Ctrl+R still works) to open the **Environment** panel. It shows only
the actions that apply now, with the recommended one first:

- **Start environment** checks AWS, prepares images and starts the enabled services.
  It begins immediately; confirmation is asked only if the plan would stop services
  that are running. Press `d` for the planned service list.
- **Apply changes** applies saved edits that are pending.
- **Stop environment** stops and removes this checkout's containers; data volumes are kept.
  It requires an explicit confirmation and remains available while other work is
  running. Stop preempts that work and persists stopped intent before cleanup.
- **Restart failing services** and **View logs**.
  Restarting failing services also asks for confirmation.

While an operation runs, the panel shows its steps and the last output lines. Esc closes the
panel without cancelling; `x` cancels. When something needs you, the panel explains the
cause and offers the fix directly: **Log in to AWS + registry**, **Set up SSH access**,
**Try again** or **View logs** (Logs with the Problems filter).

Saving through the TUI, CLI, legacy commands or an external editor stages pending
configuration. Apply or Start activates saved changes. Ordinary Apply preserves
manual service stops; service Start releases one, and Environment Start releases
all manual stops.

The daemon distinguishes saved intent from observed containers. Clean recovery
uses the verified applied checkpoint; containers running without that checkpoint
do not establish running intent. Containers stopped or started outside chs-dev
are reported as **Changed outside chs-dev**. Explicit Start or Apply reconciles
them. One-shot jobs that exit 0, such as `execute-mongo-scripts`, count as done.

Initialization runs through the Compose script runner and its existing job
dependencies. Inspect initialization task logs when seed data is incomplete.

The status bar shows one environment state and its next step:

| Status bar                          | Meaning                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `○ Stopped · Ctrl+E start`          | No enabled service is running                                  |
| `◌ Starting 12/33 · pulling images` | An operation is running; the current step is shown             |
| `● Running 33/33`                   | Every enabled service is Running, Healthy or Completed         |
| `✕ 2 failing · 31/33 up`            | Some enabled services are Unhealthy, Exited (crashed) or Dead  |
| `… · 3 changes pending · Ctrl+E`    | Saved edits are not applied yet                                |
| `▲ Needs AWS + registry login`      | Press Ctrl+L; the pending operation resumes after login        |
| `▲ Needs SSH access · Ctrl+E`       | Development builders need the Docker SSH secret files          |
| `✕ Start failed · Ctrl+E details`   | The last operation failed; the panel opens with the error once |

"Running" means configuration applied and containers up, not that every service is
fully ready; the health columns remain authoritative. Ordinary monitoring reports
failing services without restarting them. Clean daemon recovery follows the
persisted running intent described in [daemon recovery](docs/daemon.md#recovery).

**The checkout supplies configuration and builder templates.** The daemon reads
`services/**/*docker-compose.yaml`, `local/builders/*`,
`global.env`, `.env` and `.chs-dev.yaml`, and generates a self-contained Compose file for
the current configuration in its own state directory. The only project files it writes are
the ones the checkout already expects: `.chs-dev.yaml` (your selections), clones in
`repositories/SERVICE`, and the SSH secret files in `local/`. The project only needs to
be a docker-chs-development checkout (`bin/chs-dev` and `services/` present).
After changing service definitions externally, restart the daemon to rediscover them.
Development services are built by the existing builder templates in `local/builders`.
**Reload (rebuild from source)** uses the applied Compose artifacts and
`compose up --build --force-recreate --no-deps` for the service and its builder (for
example `SERVICE-builder`), so Java services re-run Maven and restart on the new jar.
Apply saved configuration changes before Reload; refreshing version metadata alone
does not change its applied image selection.
chs-dev does not run `docker compose watch`.
The standard `custom-init.sh` (which only exports AWS session credentials) is recognised
and never run: services reading `aws-session.env` receive the credentials through Compose
interpolation instead, so nothing is written to disk. A modified or unrecognised
`custom-init.sh` blocks starting with an explanation.

Preparation and Compose share an in-memory environment snapshot, in increasing
precedence: `global.env`, project `.env`, the daemon startup environment,
canonical `CHS_DEV_ROOT`, and freshly exported AWS credentials. Environment files
are parsed as dotenv data, never sourced as shell scripts. Snapshots are refreshed
for each operation, not modified by edits during an active operation. Compose's
implicit `.env` loading is disabled for these commands; declared service `env_file`
entries remain supported.
Bare `environment` entries such as `- KEYCLOAK_SECRET` (or `KEYCLOAK_SECRET:`
in map syntax) inherit a value when available and are omitted when unset, matching
Compose. A service may still need that value for its own functionality. For a
service-specific secret, use the selected checkout's `.env`; a connected frontend's
shell exports do not update the persistent daemon.
Existing development repositories at `PROJECT/repositories/SERVICE` are reused
without Git updates or resets; missing repositories are cloned there once.

When a selected development builder declares `requiresSecrets`, starting checks for
the standard Docker SSH secret files before requesting AWS credentials or
mutating Compose. If they are missing or invalid, the Environment panel offers a
TUI-native SSH setup flow. It first uses `ssh -G github.com` to find a usable
identity and also accepts an explicit key path. Relative paths are resolved
from the project checkout, while `~` and absolute paths are accepted as written.
The application creates
`PROJECT/local/.ssh_key` as a symlink and writes
`PROJECT/local/.ssh_key_passphrase` atomically with owner-only `0600`
permissions; it never copies, displays, or logs private-key contents or
passphrases. Existing valid setup is reused, while repair or replacement always
requires an explicit confirmation. The legacy `bin/init` flow remains available
for the separate interactive CLI but is not required here.

Only one mutating operation runs per checkout; competing requests receive a busy
response. Environment Stop can preempt active work. Saved edits never change an
active operation's snapshot; external configuration edits are detected by polling.
The daemon holds `live.lock` in the project's state directory. Multiple CLI, TUI
and AI clients share that daemon. Remove a stale lock only after confirming its
daemon and owned commands have ended.

Cancel (`x`) terminates owned commands, refreshes actual state, and leaves saved
changes pending until an explicit retry. No operation rolls back completed Docker changes.
Closing a frontend leaves accepted operations and the daemon running.
Failed operations open the Environment panel once with the error highlighted. If another
modal is open, the notice waits until it closes; Ctrl+E and Logs retain the details.
Preparation failures show the reason (for example an unknown service or a missing
`env_file`) in the Environment panel.

Preparing configuration verifies AWS before preparation and again before applying
containers. Explicit Apply reevaluates a nonempty selection even when its YAML has
not changed, so it can require credentials and refresh image metadata. Changes
waiting for login stay pending; **Ctrl+L** (or the panel's login fix) resumes them
after successful verification. ECR failures require **AWS + registry login**.
Dedicated environment/service Stop does not require AWS login or preparation.
Service Start/Restart and Reload reuse applied artifacts and resolve their required
environment without activating refreshed image metadata or pending YAML edits.
Only containers verified as belonging to this checkout and Compose project are
controlled; chs-dev never runs `down`, deletes volumes, or
removes broad orphans.

Logs defaults to durable TUI lifecycle events, including errors while the environment is stopped.
The displayed file is `tui.log` (JSON lines) in the project's state directory. It rotates at
5 MiB to `.1` and `.2` (oldest removed), uses owner-only `0600` permissions, and
rejects symbolic links/nonregular log files. Rotation touches only those named files.
Retention is size-based, not time-based; existing oversized logs rotate on the next write.
The TUI keeps the latest 500 structured events in memory, independent of file retention.
Session and operation UUIDs correlate configuration saves, login and environment operations;
revision hashes identify configuration snapshots. Resolving the service inventory writes
nothing.

The Logs tab renders each event as a readable line, `time  category  message`, e.g.
`14:44:09 Env    Start requested` or
`14:46:02 Docker docker compose up failed with exit code 1 (3m 0s)`. Errors are red and
warnings amber. Routine detail (command starts/successes, lock and revision events) is
hidden until you press **v**.

| Key           | Action                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| `c` / `C`     | Cycle filter: All, Env, Docker, AWS, Config, App, Problems (errors/warns)      |
| `/`           | Start or resume search; Enter keeps the query, Esc clears it and leaves search |
| `v`           | Show or hide routine detail                                                    |
| `r`           | Show the raw JSON lines (current filter still applies)                         |
| `s`           | Switch between TUI events and in-memory environment output                     |
| ↑ ↓ PgUp PgDn | Scroll (pauses following); `f` or End resumes following                        |

Environment output uses the same filters: phase messages are Env, Compose/runtime output is
Docker, and lines mentioning errors, denials or non-zero exits are Problems.

Structured logging allows only known events, statuses, numeric outcomes, validated service
identifiers, revision hashes, and for commands the program name plus known verbs (for
example `docker compose up`; never paths or other arguments). Raw errors, YAML, environment values, AWS output and child
output are **not persisted** in `tui.log`. Polling logs transitions/recovery, not every poll.
Initial logging failure prevents startup; later failures warn on stderr and in Logs without
changing command outcomes or retrying operations. Writes are synchronous and bounded, not
crash-proof audit storage; concurrent independent writers are not coordinated.

Press `s` in Logs to view environment output instead (memory-only, 5,000 lines, 2,000 characters
per line, terminal controls removed and credential redaction applied). Redaction is
best-effort, so this output is deliberately not sent to durable storage.
Use Up/Down or PgUp/PgDn to scroll and `f`/End to follow the tail.
Prepared Compose files live under `operations/` in the project's state directory; they are
retained because containers can reference generated files. Remove them only after those
containers are no longer using them. Credentials are passed in child-process memory, never
written to generated files.

Local acceptance exercises the real client, daemon/application, Ink views, HTTP
adapters and owned subprocesses with injected external dependencies and temporary
fixtures. On the macOS development copy, use the outbound-denying runner:

```sh
npm run test:local
npm run check
npm run build
```

`npm test` runs the same portable test suite without that sandbox; `test:unit` is
only a subset. See [local verification](docs/local-verification.md) for isolation
and evidence limits. The two live Microcks tests remain opt-in. Fixture results do
not establish live Docker networking, AWS permissions or business-service parity.

For the interactive login regression check on macOS/Linux, run
`npm run build && python3 test/login-terminal.py`. It uses stub AWS and Docker
commands without changing credentials or containers.

## Code quality

Run `npm run check` for formatting, lint, complexity, and type checks.
Run `npm run format` to apply four-space Prettier formatting, or
`npm run format:check` to verify it. Run `npm test` for application and tooling tests.

Run `npm run complexity:report` to find nesting and complexity hotspots, and
`npm run complexity:check` to enforce the empty warning baseline.
See [code quality checks](docs/code-quality.md) for thresholds and limitations.

Ink's `react-reconciler` dependency is pinned to 0.34.0 for the
[development profiling cleanup](https://github.com/facebook/react/pull/34803).
Version 0.33.0 retains session snapshots on every redraw and can exhaust the heap
during long TUI sessions. The [memory regression test](test/tui-memory.test.ts)
checks repeated redraws in a separate process with a bounded heap. Remove the
override when Ink's renderer dependency includes this fix.
