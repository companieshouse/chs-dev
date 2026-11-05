# Retain and simplify the host controller

Status: accepted; supersedes [ADR 0001](0001-remove-host-daemon-with-narrow-proxy.md)
and [ADR 0003](0003-coordinate-mutations-through-proxy.md).

Retain a host daemon as the shared owner of CLI, TUI and lazy lifecycle
operations, with Docker Compose as the execution backend and one active checkout
initially. Keeping ownership and execution together avoids the extra protocol
and uncertain fencing needed for proxy-granted host operations, while preserving
accepted work when its client disconnects. Simplify the existing controller
rather than moving coordination to a proxy container. Explicit Apply remains the
configuration activation boundary ([ADR 0002](0002-activate-configuration-explicitly.md)).

Persist running and stopped intent and retain an appropriate startup mechanism
for automatic clean restart, including after reboot. Detached or on-demand mode
resumes only once launched. Interrupted operations must be inspected and explicitly
reconciled; never silently replay them or claim automatic rollback.
