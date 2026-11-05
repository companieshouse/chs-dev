# chs-dev

The local development environment tool for Companies House services: it
selects, prepares, starts, and monitors a Docker Compose stack on a developer
machine.

## Language

**Environment**:
The selected local services, their configuration and their running state that
a developer's tools control together. Human and AI actions against the same
environment affect that shared state.
_Avoid_: session, workspace

**Journey**:
A named, checked-in file describing a minimal local stack: the services to
always start and the services to treat as lazy.
_Avoid_: service set, profile, stack

**Lazy service**:
An enabled service whose start is deferred until its route receives a request
and which may stop again after an idle window. A manual stop prevents that
request from starting it.
_Avoid_: on-demand service, deferred service

**Cold start**:
Starting a lazy service because its route received a request, holding the
request until the service is healthy or a time cap is reached.
_Avoid_: warm-up

**Durable start**:
Starting a journey despite individual service failures: each failed service
and its dependents are excluded, the remaining services start, and every
exclusion is reported with remediation.
_Avoid_: best-effort start, partial start

**Idle unload**:
Gracefully stopping a lazy service whose route has received no non-healthcheck
requests for an idle window.
_Avoid_: auto-stop, idle timeout

**Manual stop**:
A deliberate instruction to keep a service stopped until explicitly started
again. Incoming requests do not release it, unlike an idle unload.
_Avoid_: idle unload, disabled service

**Environment stop**:
A deliberate instruction to stop an environment's services and prevent further
cold starts until the environment is explicitly started again.
_Avoid_: idle unload, closing the TUI

**Applied configuration**:
The service configuration explicitly activated for an environment. Saved edits
do not change the applied configuration until Apply.
_Avoid_: current configuration

**Pending configuration**:
Saved service configuration changes that have not been applied to the
environment.
_Avoid_: applied configuration, unsaved draft
