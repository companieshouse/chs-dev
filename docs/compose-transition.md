# Docker Compose and upgrades from native backends

chs-dev uses Docker Compose v2 for all environment execution. Docker and the
Compose plugin must be installed and Docker must be running. The daemon, TUI,
CLI, journeys, mock providers and lazy-service proxy remain available.

Compose interprets the prepared YAML and owns dependency scheduling, readiness,
images and container lifecycle. Apple containers and the custom native Docker
scheduler, compiler and adapters have been removed.

## Before upgrading an existing native environment

1. Keep a copy of the pre-upgrade build. While that build is still installed,
   select the existing native Docker or Apple backend and use **Stop environment**.
   Let Stop finish successfully; closing the TUI alone does not stop the environment.
2. Run `chs-dev daemon stop` with that build, then install/build this version.
3. Restart the daemon and frontend together. The local protocol is now version 5;
   older clients/daemons report a mismatch instead of replacing an active daemon.
4. Choose Start explicitly. Compose creates its own environment using its existing
   storage; native data is not automatically transferred to Compose volumes.

Native volumes, images, generated files and checkpoints are retained. No automatic
migration, cleanup or storage adoption takes place. Keep the old build available
until the Compose environment is verified.

## Retired settings

The YAML keys `runtime` and `orchestrator`, and the environment variables
`CHS_DEV_RUNTIME`, `CHS_DEV_ORCHESTRATOR` and `CHS_DEV_APPLE_CLI`, are ignored.
Warnings appear in Config and CLI output. The invoking frontend also reports old
shell overrides even though they are no longer copied into a new daemon's startup
environment. Existing settings files are not rewritten just to remove these keys.

Remove the obsolete entries when convenient. Refresh an existing macOS login
service with `chs-dev daemon install` after its current work has finished so old
startup overrides are removed. Project selection and AWS/login settings continue
to work as before.

## If Compose refuses to start

Before Apply or Reload creates containers, chs-dev reads the old checkout ownership
marker and checks Docker for matching native containers, including stopped ones.
Unreleased native ownership, unreadable/corrupt markers or failed Docker inspection
block creation. These checks never claim ownership, remove resources or clear state.

Use the pre-upgrade build to complete **Stop environment** with the old backend
selected, stop that daemon, then restart this version. For marker corruption,
restore the marker from a known-good checkpoint and complete the same transition;
do not delete ownership state to bypass the check. Resolve Docker inspection errors
and retry. Apple is never invoked by the new build.

Saved native running intent is not resumed. Existing Compose intent retains its
normal recovery behaviour within the same verified login; interrupted operations
are recorded without replaying them.

## Verification

```sh
npm run check
npm test
npm run build
npm run test:docker
npm run test:docker:mocks
```

`test:docker` enables `CHS_DOCKER_INTEGRATION` for an isolated Compose lifecycle
stack and container controls. It covers dependency/job startup, repeated Apply,
Reload, exact-ID actions, lazy creation and volume-preserving Stop. The mock suite
uses the retained reverse proxy and isolated Compose projects. Integration cleanup
removes only test resources; normal Stop preserves volumes.
