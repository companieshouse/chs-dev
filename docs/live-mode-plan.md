# Docker Compose Live mode

## Summary

Add opt-in Live mode that reconciles saved configuration with Docker Compose. Enabling a service starts it and its required dependencies; disabling stops services no longer required; changing mode recreates affected services.

Support Service, Development, and Mock modes. Preserve existing CLI preparation logic through a new non-interactive API. Verification is **unit tests with dependency injection and stubs only**—no Docker, AWS, browser, subprocess, PTY, or integration tests.

## Behaviour and UI

- Default Live mode to **off on every launch**. Add `Ctrl+R` to open a runtime-control modal outside other modals.
- Enabling Live shows a grouped preview of services to start, stop, or potentially recreate, including dependencies. Confirming enables reconciliation; cancelling leaves Live off. Recheck configuration and runtime state before execution.
- Saving the service modal triggers reconciliation automatically while Live is on. Configuration remains editable during operations; queued work always uses the latest saved revision.
- Turning Live off lets the current operation finish, discards queued work, and leaves containers running. Provide separate **Cancel operation** and **Retry** actions.
- Show `Live OFF`, `Checking`, `Preparing`, `Applying`, `Synced`, `Blocked`, `Failed`, or `Cancelling` in the status bar alongside AWS status.
- Populate Logs with operation output, timestamps, affected services, and completion results. Keep a bounded 5,000-line in-memory buffer, truncate oversized lines, support scrolling and follow-tail, and remove terminal control sequences.
- Treat “Synced” as configuration applied, not “all services healthy.” Existing service health columns remain authoritative.

## Preparation and runtime implementation

### Non-interactive CLI preparation

Make a coordinated change in the existing CLI repository. Extract preparation from `up` into a reusable service and expose a versioned `chs-dev runtime prepare` command.

- Accept an explicit project directory, immutable configuration snapshot, and operation output directory.
- Reuse service resolution, exclusions, development generators, repository preparation, validation, and custom initialization.
- Generate operation-specific Compose artifacts with correctly resolved paths. Do not overwrite the user’s desired configuration or modify artifacts used by an in-flight operation.
- Preserve existing development behaviour: Node’s in-container watching, development mounts and builders, and existing manual-reload requirements for other builders.
- Do not start containers, launch login, install/update tools, prompt, or follow logs.
- Return a machine-readable manifest containing protocol version, Compose files, project identity, effective service/mode inventory, and environment requirements. Send progress to stderr.
- Keep credentials and private-key contents out of the manifest and logs. Resolve environment requirements through an injected environment provider; export AWS credentials into child-process memory only.
- Fail preparation on required initialization or generation failures. Keep existing interactive `up` behaviour compatible through the extracted service.
- Require this protocol explicitly in the TUI; an older CLI disables Live with an actionable message. Do not invoke the checkout’s potentially interactive `bin/chs-dev` wrapper.

### Docker strategy

Extend the existing strategy contracts with richer runtime snapshots, prepared-project metadata, and typed operation results.

- Snapshots identify service, container, Compose project, configuration identity where available, lifecycle, and health. Preserve normalized statuses for existing screens.
- Inject process execution, filesystem access, environment resolution, and credential acquisition into adapters.
- Run Compose with explicit project identity, project directory, prepared files, and environment. Validate generated configuration before starting.
- Let Compose manage dependency ordering, builds, and change detection. Use detached `up` to reconcile the prepared desired project; avoid blanket forced recreation.
- Stop obsolete services by verified container IDs belonging to this checkout and Compose project. Do not use global cleanup, `down`, volume deletion, or broad orphan removal.
- Keep shared dependencies and base infrastructure when still present in the effective desired project.
- Stopping must work without AWS credentials or fresh Compose preparation.
- Stream stdout/stderr into operation events. Cancellation terminates the owned process tree, waits for termination, and refreshes actual state; it does not roll back completed Docker changes.

## Reconciliation and authentication

Implement a framework-independent controller, with React hooks subscribing to its state.

- Inject the runtime strategy, preparation API, configuration store, AWS verifier, clock/scheduler, and event sink.
- Allow one mutation operation per project at a time. Use a project-scoped ownership lock to prevent competing Live sessions.
- Debounce saved edits by 250 ms. Assign each configuration revision an immutable snapshot; newer revisions replace queued work but cannot alter an active operation.
- Resolve desired state using the CLI’s effective inventory so execution and generated Compose agree. Detect discrepancies with the TUI’s inventory and block rather than silently execute a different service set.
- Check Docker availability before mutation. Before preparation or any start/recreate, perform a fresh AWS check rather than trusting the status-bar cache.
- When AWS is expired or unavailable, retain pending changes, show the reason, and offer `Ctrl+L`. Stop-only work remains allowed.
- After successful authentication verification, retry the latest pending revision if Live is still on.
- Treat ECR authentication failures separately: offer AWS + Docker login. Resume only after that login succeeds and AWS verification passes.
- On other failures, retain configuration and actual partial state, show the failed operation, and require Retry or a newer configuration revision. Do not enter an automatic retry loop.
- Polling updates observed state and detects drift, but does not repeatedly restart unhealthy containers. Reconcile initial activation, saved changes, successful login recovery, and explicit Retry.
- Cancelling pauses pending execution until Retry, a newer edit, or Live reactivation. Turning Live off never resumes pending work after login.
- On exit, cancel owned commands, release the ownership lock, and leave containers running. Do not attempt rollback.

## Unit test plan and delivery

Use injected fakes, controllable promises, in-memory files, and fake clocks. New tests must not access real tools, credentials, networks, or repositories.

Cover:

- Live-off saves, activation preview/confirmation, unchanged configurations, and unsupported capabilities or CLI versions.
- Enabling, disabling, mode changes, exclusions, shared dependencies, base services, and foreign-project isolation.
- Development preparation, generated path correctness, environment requirements, and initialization failures.
- AWS active/expired/unavailable, stop-only operations while logged out, ECR failures, and login-triggered recovery.
- Rapid edits, single-operation execution, immutable active snapshots, coalesced pending revisions, and external configuration changes.
- Turning Live off during execution, cancellation, partial failure, retry, shutdown, and ownership-lock release.
- Docker argument construction, cancellation signalling, exit-code handling, output limits, and secret-safe logs.
- Preview, status-bar, and Logs view models through pure unit tests.

Deliver in order: CLI preparation API and tests; injected Docker execution; reconciliation controller; TUI controls and Logs. Preserve four-space formatting. Run unit tests, typecheck, build, and formatting checks only; explicitly leave real-environment compatibility verification for a later phase.
