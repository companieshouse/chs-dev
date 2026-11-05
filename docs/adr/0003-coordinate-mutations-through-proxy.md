# Coordinate environment mutations through the proxy

Status: superseded by [ADR 0004](0004-retain-host-controller.md).

This exploration proposed proxy-granted exclusive mutation access while host
processes executed commands. It required a coordination and recovery protocol
that could not itself prove a disconnected host command had stopped. The accepted
direction keeps ownership and execution together in the host controller.
