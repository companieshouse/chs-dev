# Remove the host daemon and retain a narrow proxy container

Status: superseded by [ADR 0004](0004-retain-host-controller.md).

This exploration proposed host commands with a proxy container owning lazy
lifecycle, accepting that operations could end when their client exited. The
accepted direction retains the host controller and operation survival instead.
