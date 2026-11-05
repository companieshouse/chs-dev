# SSM secrets

`chs-dev secret` manages individual AWS SSM Parameter Store secrets directly,
without starting or contacting the daemon. Each command requires an explicit
`--namespace`, `--profile` and `--region`. Ask Platform for the approved namespace,
naming conventions, authentication, developer/pipeline IAM access and KMS policy.
This implementation does not establish or approve those organization decisions.

Use an installed AWS CLI v2 with an authenticated named profile. The adapter
checks `aws configure get cli_history` for that profile before each SSM request:
an unset setting (exit 1 with no output) or explicit `disabled` is accepted;
enabled, unknown or unreadable configuration prevents the request. Configure
`cli_history=disabled` for the selected profile before use. Do not change that
configuration concurrently with a secret command. The checks are tested through
injected CLI responses; installed AWS CLI internals and organizational access have
not been validated by live calls.

For example, after setting the three variables below to Platform-approved
configuration, pipe a value from your secret source:

```sh
secret-source-command | chs-dev secret create database/password \
    --namespace "$APPROVED_SSM_NAMESPACE" --profile "$AWS_PROFILE" \
    --region "$AWS_REGION"
```

`secret-source-command` stands for your existing secret source. Do not put the
value into a shell argument, shell history, environment variable or temporary
file. Terminal stdin is refused because typed values would echo. Input must be
1–4096 valid UTF-8 bytes; whitespace, BOM and trailing newlines are preserved.
A newline emitted by the source becomes part of the value.

The namespace is an absolute SSM path without trailing, empty or traversal
segments. Secret names are relative paths such as `database/password`; each
segment allows letters, digits, `_`, `.` and `-`, excluding `.` and `..` alone.
Absolute names and traversal are rejected. Names remain inside the supplied
namespace. The supported full path is limited to 900 characters and 15 segments;
AWS may impose a tighter account/partition-specific length limit.

Create uses Standard `SecureString` and refuses to overwrite an existing secret.
Use update to replace an existing value:

```sh
secret-source-command | chs-dev secret update database/password \
    --namespace "$APPROVED_SSM_NAMESPACE" --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" --key-id "$APPROVED_KMS_KEY_ID"
```

`--key-id` is optional on create/update and accepts a KMS key ID, ARN or alias.
Omitting it leaves AWS to choose its managed SSM key; no approved KMS policy is
inferred. Supply the approved customer-managed key on every write when required.
Update checks that an existing `SecureString` is accessible before overwriting.
SSM provides no atomic “update only if still present” primitive here: another
writer may change the value or delete it between the check and write. Concurrent
changes can be overwritten, and a concurrent deletion can be recreated. Coordinate
writers when that matters; this command does not promise transactional updates.

Retrieving a value requires deliberate `--reveal`. It emits only the exact value
to stdout, without an added newline, JSON wrapper or metadata. Pipe it straight to
its consumer; displaying or retaining stdout exposes the value:

```sh
chs-dev secret get database/password --reveal \
    --namespace "$APPROVED_SSM_NAMESPACE" --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" | consuming-command
```

`--json` is supported for create/update/delete completion and errors, and refused
for get. No value is returned in metadata, daemon snapshots, operation history,
telemetry or generated project files. AWS input travels through a private stdin
pipe, never argv or a temporary file; process output stays private and provider
error details are replaced with fixed messages. This protects chs-dev's own paths;
it does not control a modified AWS executable, external credential helpers,
third-party CLI plugins, terminal recording or the receiving command. The history
check and subsequent AWS invocation are separate processes, so simultaneous AWS
configuration changes remain an external race.

The whole command defaults to a 30-second deadline, including stdin. Override
with `--timeout` greater than zero and at most 60 seconds. Each child process also
has a 30-second deadline and receives cancellation. An interrupted or failed write
may have reached AWS; retrieve the value before deciding to retry. Missing,
already-existing, denied, expired-credential and malformed-response failures are
reported without echoing provider output or secret values. Check the explicit
configuration, authenticate the named profile or ask Platform for SSM/KMS access
as directed. No permission changes or automatic retries are performed.

Remove a secret explicitly when it is no longer needed:

```sh
chs-dev secret delete database/password \
    --namespace "$APPROVED_SSM_NAMESPACE" --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" --json
```

Delete affects that parameter only and reports a missing secret. It does not
remove AWS CLI history or other copies created outside chs-dev. Environment Stop
and local cleanup do not delete remote parameters.

This ticket delivers explicit storage CRUD. It does not fetch secrets into
Compose environment variables, settings, configuration snapshots or generated
files. Any runtime integration needs a separately designed private value seam;
secret values must not pass through retained controller logs or snapshots.
