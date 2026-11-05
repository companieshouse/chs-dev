# Local verification

On the macOS development copy, run `npm run test:local` for the normal test
suite. For a focused run, use `node scripts/test-local.mjs test/cli.test.ts`.
The runner deliberately fails on other platforms. `npm test` remains the
portable test command and does not impose this sandbox.

The local runner uses the macOS process sandbox to deny outbound network access
for tests and their child processes. Loopback connections and Unix sockets in
the per-user temporary directory and `/tmp` remain available for fixtures,
including the process guardian. It supplies isolated
configuration and state directories, an empty AWS configuration, and an absent
Docker socket; it also denies reads of the user's AWS/SSH directories and
execution of `/usr/bin/ssh` and `/usr/bin/rsync`.

Tests must still inject external dependencies and use their own fixture endpoints.
Loopback permission is for those fixtures, not permission to contact a running
local engine or service. No live Docker, AWS, remote machine or telemetry service
is needed. The two Microcks live tests remain opt-in and skipped by this runner.

Run `npm run check` and `npm run build` alongside the relevant tests. Fixture
results establish local behavior, argument generation and error handling; they
do not establish live Docker networking, AWS IAM access or image compatibility.
