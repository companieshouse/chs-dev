# Directions

High-level directions worth exploring for chs-dev. These are not tasks: none
of them is scoped, scheduled, or committed to. Each one is a question to
investigate until it can be dropped, adopted, or turned into concrete work
(a spec or tickets under `.scratch/<feature>/`).

When an exploration settles, record the outcome here in one line — what was
decided and where the follow-up lives — then remove or archive the item.

## 1. Lazy loading for services — settled

Settled 2026-11-04: adopted and implemented. Services can be lazy in
journeys and via start modes; the label-driven proxy cold-starts them on
request and idle-unloads them after 30 minutes, and the usage cache learns
lazy from real traffic. Follow-up lives in
[Start modes](docs/start-modes.md), `.scratch/chs-dev-remediation/` (tickets
10–12), and `.scratch/usage-cache/spec.md`; real-stack verification is
tracked in the workspace `LAZY-LOADING-TEST-PLAN.md`.

## 2. Review UI / UX

How can the chs-dev UI and user experience be improved so common workflows are
clearer, more consistent and easier to use?

To find out: which workflows and screens cause friction, where terminology or
feedback is unclear, and what changes would improve discoverability,
accessibility and error recovery.

## 3. Rebuild images for ARM

Can the images chs-dev depends on be built or rebuilt natively for ARM
(`linux/arm64`), so Apple Silicon machines stop relying on AMD64 emulation?

To find out: which images are AMD64-only today, which do we control the build
of, and what would rebuilding or switching to multi-architecture images cost?

_Docker Compose is the only backend. Image platform selection follows the
Compose definitions and Docker image availability._

## 4. Common config

Can configuration live in one common place instead of per service — a single
config directory for everything, and/or one global environment that every
service shares?

To find out: what config is currently duplicated or scattered across services,
what genuinely has to stay per-service, and whether a shared layer would make
setup simpler or just hide where values come from.

## 5. Native executor

Can services run directly on the Mac as native processes, instead of in
containers at all?

To find out: what containers currently give us (isolation, dependencies,
networking, reproducibility) that a native executor would have to replace,
and which services would or would not suit running on the host.

_A host-process executor would be a new backend; the current product uses
Docker Compose only._

## 6. Worktrees

What is a good way to work with Git worktrees in chs-dev — for example,
running separate checkouts of the same services side by side without them
colliding?

To find out: where a second checkout breaks today (ports, container and
volume names, config, state), and what chs-dev would need to key off the
checkout so parallel worktrees stay isolated.

## 7. Dev containers

What is a good way to work with dev containers across all of this, so that in
development mode a project can be opened very easily in a VS Code or
IntelliJ dev container?

To find out: what a dev container would need to contain (runtimes, Docker
access, chs-dev itself), how it interacts with services running in
containers, and how much per-service setup it removes.

## 8. Telemetry

Can chs-dev record what users do and what errors they hit, and submit that to
a central server so usage can be analysed and problems spotted before they
are reported?

To find out: what events are worth recording, what must never be recorded,
where the data would go and who can see it, and how consent and opt-out
work. This needs a privacy decision before any implementation.

## 9. Secrets via SSM

Can secret environment variables be fetched from AWS SSM (Parameter Store /
Secrets Manager) via the AWS SDK, instead of being exposed in local files —
matching how other services in CI/dev already store theirs?

To find out: which current environment variables are actually secrets, how
developers would authenticate and get access, what happens offline or
without credentials, and how SSM values override or combine with local
config (see [Common config](#4-common-config)).
