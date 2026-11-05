# chs-dev

The local development environment tool for Companies House services: it
selects, prepares, starts, and monitors a Docker Compose stack on a developer
machine.

## Language

**Journey**:
A named, checked-in file describing a minimal local stack: the services to
always start and the services to treat as lazy.
_Avoid_: service set, profile, stack

**Lazy service**:
A journey service that is not started with its journey; it starts when its
route first receives a request and stops again after an idle window.
_Avoid_: on-demand service, deferred service

**Cold start**:
The proxy starting a lazy service because its route received a request,
holding the request until the service is healthy or a time cap is reached.
_Avoid_: warm-up

**Durable start**:
Starting a journey despite individual service failures: each failed service
and its dependents are excluded, the remaining services start, and every
exclusion is reported with remediation.
_Avoid_: best-effort start, partial start

**Idle unload**:
The proxy gracefully stopping a lazy service whose route has received no
non-healthcheck requests for an idle window.
_Avoid_: auto-stop, idle timeout
