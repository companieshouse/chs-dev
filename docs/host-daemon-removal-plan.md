# Host daemon removal exploration

Status: historical and superseded. The accepted direction is to retain and
simplify the host daemon as the single command owner; see
[ADR 0004](adr/0004-retain-host-controller.md) and the
[delivery plan](../../DELIVERY-PLAN.md). The proxy-grant and host execution
design described by [ADR 0001](adr/0001-remove-host-daemon-with-narrow-proxy.md)
and [ADR 0003](adr/0003-coordinate-mutations-through-proxy.md) is not the
implementation plan. Accepted operations continue if their client disconnects.

The removal option separated command coordination in a proxy container from
host execution. It required a control protocol and recovery that could establish
whether disconnected host work had stopped. Keeping ownership and execution in
the host controller better fits shared human and AI control and avoids that
additional coordination. The old daemon-deletion line-count estimate assumed
losing shared clients and reconnectable operations; it is not an estimate for
this retained-controller design.

The following behaviour remains in scope regardless of process placement:

- Save stages configuration; explicit Apply activates it. External file edits
  follow the same rule. Applied and pending configuration remain distinguishable.
- Manual service Stop blocks cold starts for the service and its dependents;
  traffic and ordinary Apply respect it. Explicit service Start/Restart or
  environment Start may release it. Idle unload is distinct and permits a later
  cold start. Blocked requests receive a clear 503 response.
- Serialize environment mutations. Ordinary competing commands return structured
  `BUSY`; cold starts wait within their request deadline. Existing traffic can
  continue while Apply delays a new cold start.
- Environment Stop records stopped intent, blocks new cold starts, requests
  cancellation of active work and stops managed containers while retaining
  volumes. Report incomplete cleanup accurately.
- Interrupted Apply blocks automatic changes until explicit reconciliation
  establishes that old work has stopped. Preserve and report actual remaining
  state; never silently replay work or claim automatic rollback.
- Clean restart may restore applied configuration and persisted running/stopped
  intent, including manual stops. Automatic reboot recovery requires a startup
  mechanism; detached/on-demand mode resumes only once launched. Interrupted
  operations and builds never replay.
- Keep one active checkout and shared human/AI control through the CLI and
  structured JSON. Retain progress, cancellation and revision conflict detection.

Further lifecycle design and verification belong to the delivery plan. In
particular, protect in-flight requests and dependencies when deciding whether a
service is idle, and ensure container restart policy respects stopped intent.
