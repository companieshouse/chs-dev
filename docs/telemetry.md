# Optional operation telemetry

Collection is off by default. An endpoint alone never enables it. This release
implements a small, lossy HTTP client for the existing JSON ingest contract; it
establishes no organizational approval to collect data or operate that service.
Use only an approved endpoint after the privacy and operational decisions below
have owners.

To opt in, supply all three daemon startup variables:

```sh
export CHS_DEV_TELEMETRY=on
export CHS_DEV_TELEMETRY_ENDPOINT=https://approved-telemetry.example/events
export CHS_DEV_TELEMETRY_INSTALL_ID=306c010c-a36e-4efe-a4b2-a51dfbd07eaf
```

The endpoint is an example, not a deployed service. Generate your own random UUID
v4 for the install ID; the shown UUID is illustrative. Store that UUID in your
own startup configuration if you want continuity across restarts. chs-dev does
not generate an ID, read an identity file or persist queued events. Do not use an
email address, username, path or credential as an ID; invalid IDs disable sending.

Set `CHS_DEV_TELEMETRY=off` or `DO_NOT_TRACK=1` for a clear opt-out. Any value other
than exact `on` disables collection. Configuration is read when the daemon starts;
a frontend shell does not reconfigure an existing daemon. Detached mode uses its
startup environment. On macOS, `chs-dev daemon install` refreshes the installed
login service's startup environment, so run it with the opted-in or opted-out
variables as appropriate. Restart alone retains that installed configuration.
Validated endpoint and install ID can appear in that startup configuration file;
secret values and telemetry events do not.

Only HTTPS endpoints ending exactly `/events` are accepted, except HTTP on
localhost/127.0.0.1/::1 for local fixtures. Credentials, query strings, fragments,
other paths and malformed URLs disable collection. Invalid telemetry settings
never prevent ordinary commands. Invalid endpoint material is also excluded from
the login-service file. The client does not follow redirects or send authentication
headers. An approved authenticated gateway design remains operational work.

One shared operation owner records each accepted operation after its final state
is saved, regardless of whether CLI or TUI submitted it. If saving operation state
fails, a best-effort STATE_WRITE_FAILED completion reports that persistence failure;
it does not imply the final state was saved. Retrying the same accepted
request does not duplicate telemetry. Reads, invalid/rejected requests, frontend
rendering, restored interrupted records and direct secret commands produce no
telemetry. Duration covers the accepted operation, including its queue time;
clock changes are bounded to 0–24 hours. Completion outcome codes are normalized:
0 succeeds, 1 fails and 130 is cancelled; these are not raw subprocess exit codes.

The schemaVersion=1 payload contains:

| Event               | Sent fields beyond type/version/UTC timestamp/random install ID                     |
| ------------------- | ----------------------------------------------------------------------------------- |
| `command-completed` | Fixed command name, integer duration in milliseconds, normalized outcome code       |
| `error-occurred`    | Fixed command name, allowlisted error category, literal `Operation failed.` message |

The client constructs new allowlisted payloads. It never serializes request
arguments, process environment, service/journey/project names, paths, image IDs,
operation/client/request IDs, raw errors, logs or secret values. Unknown commands
are dropped; unknown error codes become `OPERATION_FAILED`. It does not use the
ingest server's partial-token/environment redactor.

`service-toggled`, `provider-changed` and `journey-selected` remain deferred:
that existing schema requires service or journey names. There is no approved
identifier policy or safe source for those fields, and inventing a placeholder
name would misrepresent usage. Provider counts and platform/version metadata are
also absent in this first scope. Future collection needs an explicit privacy
review and suitable shared-owner event source.

At most 50 events wait in memory, with one batch of at most 20 in flight. Flushes
are spaced by at least one second; each HTTP attempt has a one-second absolute
deadline. Overflow, rejected responses, timeouts and transport failures drop data.
There are no retries, disk queue, response/error-body retention or diagnostic
sends. Shutdown discards pending events and aborts the active request immediately;
it does not delay environment operations to drain telemetry. Synchronous and
asynchronous observer failures cannot change operation outcomes. These counts
are approximate usage observations, unsuitable for billing or audit guarantees.

# Local investigation and recommendation (RAND-734)

The adjacent `chs-dev-telemetry-server` already implements `POST /events` for the
five-event JSON schema, request limits, per-install throttling, MongoDB storage,
a 180-day TTL index and deletion by install ID. Its code contains no ingest or
delete authentication middleware or production TLS configuration. Its validator
also permits free-text messages and environment values; its environment redactor
retains token prefixes and accepts unrelated environment values. Those are
material privacy/operational gaps if other clients send broader data. This client
sends neither category. No sibling server files or deployment were changed.

| Choice                     | Evidence and consequence                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing small HTTP ingest | Concrete contract and storage implementation already exist locally. Native Node HTTP(S) needs no new client dependency and can send the narrow safe subset. Server ownership, authentication, retention and deployment still need decisions.                    |
| OpenTelemetry              | No SDK, exporter, Collector or approved backend integration exists in this workspace. It would add event/metric mapping, dependencies and operator configuration. It becomes attractive if the organization supplies an approved shared observability platform. |

Recommend the existing HTTP contract for a deliberately opt-in, minimal pilot,
keeping the transport behind the small client interface. This is a local technical
recommendation, not an approved hosted provider selection. Do not add an
OpenTelemetry SDK merely to wrap two custom JSON events. If an approved Collector
already exists, a concrete follow-up is Node operation counters and a duration
histogram, allowlisted outcome/command attributes, OTLP/HTTP to that Collector and
its approved backend. Disable default process/environment resource enrichment;
validate the resulting attributes and failure behavior before enabling it. That
alternative has not been implemented or tested here.

Before hosted collection, agree ownership/support, endpoint/authentication/TLS,
consent and notices, allowed identifiers/fields, retention, access control,
backups/deletion, throttling/abuse controls and costs. The existing 180-day TTL is
code, not an approved retention policy. Existing deletion routes identify data by
install ID and need authorization before exposure. Hosting or license prices,
usage volumes and platform availability cannot be established from this code;
no cost estimate or deployment claim is made.

# Automated verification

Tests use the actual application/operation owner with injected runtime responses,
the production buffered client and native HTTP transport, and loopback receivers.
They cover opt-out/invalid configuration, no sensitive fields, duplicate requests,
operation failure/cancellation, observer isolation, bounded batches/queue, server
failure, absolute timeout, no redirects and abort-on-shutdown. The pinned ingest
schema is a test-only, byte-identical schemaVersion=1 snapshot from the adjacent
server on 2026-11-05. Tests always validate against it and compare the actual
sibling source when present; standalone checkouts still run the pinned contract
assertions without skips. No server dependencies or MongoDB binaries are needed.
