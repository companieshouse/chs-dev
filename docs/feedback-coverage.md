# Feedback coverage: RAND-739

Local audit of the archived `local-dev-env-feedback` material on 2026-11-05,
with delivery evidence reconciled on 2026-11-06.
This is a coverage ledger, not a claim that every issue is fixed. It includes
all 25 substantive top-level messages and 55 replies. Authors are credited as
reporters or contributors, not assigned as owners. No Slack/Jira messages or
live source refresh were performed.

Source: [raw archive](../../archive/2026-11/slack/slack-analysis/slackmsgs-local-dev-feedback.json).
The 21 canonical suggestions are in [suggestions.json](../../archive/2026-11/slack/slack-analysis/suggestions.json);
`direct-vault-access` is an additional superseded proposal tagged in raw messages.
Times in the export are not reliable dated permalinks. Historical statuses and
claims of resolution are not current acceptance evidence.

## Requirement dispositions

Each source row below points to the disposition of every tagged requirement.
Multiple requirements retain separate obligations. Local completion below means
fixture-verified tooling behavior; organizational, platform and service gaps stay
explicit.

### secure-local-secrets

W5 / RAND-733: `55c3d09` delivers configured, tested SSM CRUD; namespace, IAM and classification remain external. No automatic Compose secret injection promised.

### kafka-dependency-cleanup

W3: preparation supports both Compose dependency syntaxes; `cd0183e` verifies a representative dual-Kafka docgen composition and causal exclusions. Dual Kafka can be intentional for migration/rollback; service owners decide removal. See [dependency findings](dependency-findings.md).

### lean-service-selection

W3/W4: journeys, exclusions, lazy services and mocks reduce declared closure. The reported 83-service closure and business dependency correctness remain unproven.

### versioned-service-configuration

External: versioned config/branch compatibility and ownership across three repositories. Image pins alone do not solve configuration drift.

### image-version-visibility

W2/W4 / RAND-736: `f90b861` distinguishes saved preferences from observed image references and engine IDs, including dormant Development/Mock preferences. Explicit metadata refresh does not change runtime; Apply reevaluates the selection, while Reload retains applied artifacts. Local ECS/cache/client/Ink evidence does not establish live image availability.

### local-automated-testing

Local fixture suite covers tooling behavior. Full Karate/CIDEV business suites, service-contract fidelity and CI ownership remain external.

### reliable-service-startup

W1/W3: explicit activation, durable priority Stop, applied dependency conditions, manual holds, bounded cold starts and verified clean daemon recovery are implemented and independently reviewed. Failed/interrupted work and unconfirmed previews cannot authorize automatic changes. Service-specific faults remain external without reproducible local evidence. [Recovery](daemon.md#recovery) records the Docker-only restart and unsupported-transport limits.

### simplify-service-architecture

External modernization/ownership/funding scope. Simplifying chs-dev does not consolidate Companies House business services.

### actionable-diagnostics

W2/W3: visible failures, causal dependency blockers and command/progress diagnostics. `6cfad7c` preserves exit 137 without OOM evidence as uncertain rather than declaring an OOM kill; 17 focused tests pass.

### personal-remote-environments

RAND-740/741 investigation documents ownership/path/network boundaries; per-developer cloud provisioning/routing/data remain external.

### windows-support

RAND-741 investigation: WSL candidate, native Windows assumptions identified. No Windows support certification from macOS fixtures.

### arm64-images

Platform/image-publisher work: suitable manifests and native/emulated validation. Tool platform metadata does not establish availability/performance.

### configurable-mocks

W2/W4 / RAND-737: declarative Service/Development/Mock, OpenAPI scenarios and callbacks. `1049258` preserves split UTF-8 callback bodies and tests cancellation/redacted failures; `92eb203` removes a duplicate retry path. Starter contracts are not comprehensive service fidelity; two live Microcks tests remain opt-in.

### feature-flag-management

External product scope: GUI, owners, environment isolation, audit, expiry and language libraries. No RAND child currently implements this system.

### reduce-startup-resource-use

W3: safe lazy startup/idle behavior and fixture closure sizes. Real RAM/startup savings, Java tuning and minimal image supply remain unverified/external.

### docgen-regression-scenario

W3/W7: `cd0183e` tests representative docgen dual-Kafka composition, health/job conditions, host proxy routing and causal missing-configuration exclusions. Generic controller/runtime fixtures cover shared control. Real GCI company-snapshot generation remains unverified; [dependency findings](dependency-findings.md) record the narrower evidence.

### tester-friendly-interface

W2: `fc5822d` delivers the compact TUI with exact details, clear saved/observed state, visible failures, help and paging. `0262f8c` exposes manual Stop for idle services; `f8327a0` keeps confirmed Environment Stop available during other work. Real Ink interactions and 80/120/160-column frames are reviewed. This partially addresses usability; it does not deliver the originally requested graphical application or establish usability with testers outside the fixture scenarios.

### dotfiles-for-remote-environments

RAND-741 investigation records remote developer configuration; provisioning/configuration synchronization remains external.

### shared-environment-data

External: standard permitted dataset, repeatable seeding/init and owners. Image parity is not data parity.

### use-cidev-for-dependencies

External follow-up: remote dependency routing and write/migration isolation. Version copying does not implement this mode.

### chs-dev-responsiveness

W1/W2: nonblocking operations, immediate local usage errors and honest saved-versus-applied feedback; fixture timing is not a live performance claim.

### direct-vault-access

Superseded proposal in this archive: later Platform guidance favors SSM retrieval. Do not implement direct Vault access or infer current organizational approval.

## Evidence index

- W1: `71e0cfb` stages all saves until Apply/Start, preserves manual stops and
  refuses Reload when saved changes are pending. Controller/runtime/CLI suites:
  116 focused tests passed; independent Spec and Standards rounds completed.
- W2: `fc5822d` compact real Ink TUI; full exact details, saved version labels,
  failure hints and restored logs/resize regression. 18 focused tests passed.
- W3/W4: `2c655fa` applies shared lifecycle guards and immutable Reload artifacts
  (103 focused tests). `f90b861` completes version provenance/cache acceptance;
  combined W4 suite: 84 pass, two intended live skips, 18 real Ink frames reviewed.
  `00e5f15` makes stopped intent durable before cleanup; `6305865` uses applied
  logical chains for manual Start/Restart. `6f4d555` pins the supported local
  engine; `6132ea1` restores verified applied intent asynchronously. Independent
  review corrections `0f9f86c` and `7a5d933` close membership, preview, failed-action
  and checkout-switch authority gaps. Original public regression probes now pass.
  [Dependency findings](dependency-findings.md) record actual local closures and
  ten dual-Kafka declarations without changing them.
- W5: `55c3d09` SSM CRUD; `ad526de` bounded opt-in operation telemetry.
  Independent review correction `68e9739` canonicalizes startup URLs and adds
  real process privacy and negative telemetry evidence; 32 focused tests/check
  pass. Operational decisions remain explicit in [secrets](secrets.md),
  [telemetry](telemetry.md) and the [delivery plan](../../DELIVERY-PLAN.md).
- W6: `59fbe4c`, [workspace/platform spike](workspaces-and-platforms.md), 29 local
  discovery/preparation tests passed. No live platform compatibility claimed.
- [Local verification](local-verification.md) explains the enforced test boundary.

Final source checkpoint `98d4c0e`: **603 tests, 601 passed, two intentional live
Microcks skips, zero failures** under `npm run test:local`. `npm run check`
(including an empty complexity baseline), build and built CLI/general/secret help
pass. Separate Spec and Standards reviews have no unresolved findings. Terminal
fixtures wait for Ink's render flush and visible operation completion; no timeout
was raised or assertion removed to obtain the final result. Detailed review and
handoff evidence is indexed in the [delivery tracker](../../DELIVERY-PLAN.md).

## Every source message and reply

| Source ID       | Reporter / contributor   | Disposition                                                                                                                                                   |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message-001`   | Tom Strickland           | [local-automated-testing](#local-automated-testing) [shared-environment-data](#shared-environment-data)                                                       |
| `message-002`   | Tom Strickland           | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `message-003`   | Tom Strickland           | [lean-service-selection](#lean-service-selection)                                                                                                             |
| `reply-003-001` | Christopher Gregory      | [lean-service-selection](#lean-service-selection)                                                                                                             |
| `reply-003-002` | Joel Clemence            | Request for specific failing services; retained as diagnosis/ownership context, not a new tool feature.                                                       |
| `reply-003-003` | Tom Strickland           | [reliable-service-startup](#reliable-service-startup)                                                                                                         |
| `reply-003-004` | Christopher Gregory      | Oracle-query and identity-verification intermittent startup: exact service/resource cause remains unknown; no live reproduction available.                    |
| `reply-003-005` | Tom Strickland           | Authentication startup and Kafka instability: W3 can report causal blockers; service failures require separate evidence.                                      |
| `message-004`   | Tom Strickland           | [reliable-service-startup](#reliable-service-startup)                                                                                                         |
| `message-005`   | Artemis Gardner          | [lean-service-selection](#lean-service-selection) [configurable-mocks](#configurable-mocks)                                                                   |
| `message-006`   | Mihai-Cristian Buleandra | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-006-001` | Tom Strickland           | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `message-008`   | Nicola Evans             | [reliable-service-startup](#reliable-service-startup)                                                                                                         |
| `reply-008-001` | Neil Shadrach            | [reliable-service-startup](#reliable-service-startup)                                                                                                         |
| `message-009`   | Martin Westacott         | Kafka/kafka3 stability and consumer restart cascades: service/platform defect remains external; W3 covers tool control/readiness only.                        |
| `message-010`   | Kieran O'Leary           | [actionable-diagnostics](#actionable-diagnostics)                                                                                                             |
| `message-011`   | Dan Toulcher             | [versioned-service-configuration](#versioned-service-configuration)                                                                                           |
| `message-012`   | Neil Shadrach            | [lean-service-selection](#lean-service-selection) [reliable-service-startup](#reliable-service-startup)                                                       |
| `message-013`   | Tom Strickland           | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `message-014`   | Christopher Gregory      | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-001` | Tom Strickland           | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-002` | Christopher Gregory      | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-003` | James Bishop             | Kafka naming/version clarification; no standalone implementation request.                                                                                     |
| `reply-014-004` | Tom Strickland           | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-005` | Christopher Gregory      | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-006` | James Bishop             | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-007` | Martin Westacott         | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-008` | Tom Strickland           | [kafka-dependency-cleanup](#kafka-dependency-cleanup)                                                                                                         |
| `reply-014-009` | Martin Westacott         | Acknowledgement of AND-versus-OR dependency query clarification; no standalone implementation request.                                                        |
| `message-015`   | Gagondeep Srai           | [actionable-diagnostics](#actionable-diagnostics) [use-cidev-for-dependencies](#use-cidev-for-dependencies)                                                   |
| `message-017`   | Joel Clemence            | Scenario collection request; reply-017-001 supplies docgen/GCI/Kafka case. No service-owner report sent during local delivery.                                |
| `reply-017-001` | Martin Westacott         | [docgen-regression-scenario](#docgen-regression-scenario)                                                                                                     |
| `message-018`   | Lea Farmer               | [simplify-service-architecture](#simplify-service-architecture)                                                                                               |
| `reply-018-001` | Joel Clemence            | [simplify-service-architecture](#simplify-service-architecture)                                                                                               |
| `reply-018-002` | Steve Hicks              | [simplify-service-architecture](#simplify-service-architecture)                                                                                               |
| `message-019`   | Stefano Basile           | [secure-local-secrets](#secure-local-secrets) [direct-vault-access](#direct-vault-access)                                                                     |
| `reply-019-001` | Tom Strickland           | [secure-local-secrets](#secure-local-secrets) [direct-vault-access](#direct-vault-access)                                                                     |
| `reply-019-002` | Joel Clemence            | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-019-003` | Joel Clemence            | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-019-004` | Tom Strickland           | [secure-local-secrets](#secure-local-secrets) [versioned-service-configuration](#versioned-service-configuration) [direct-vault-access](#direct-vault-access) |
| `reply-019-005` | Tom Strickland           | [secure-local-secrets](#secure-local-secrets) [versioned-service-configuration](#versioned-service-configuration)                                             |
| `reply-019-006` | Joel Clemence            | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-019-007` | Joel Clemence            | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-019-008` | Stefano Basile           | [secure-local-secrets](#secure-local-secrets) [direct-vault-access](#direct-vault-access)                                                                     |
| `reply-019-009` | Stefano Basile           | [secure-local-secrets](#secure-local-secrets) [direct-vault-access](#direct-vault-access)                                                                     |
| `reply-019-010` | Tom Strickland           | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `reply-019-011` | Stewart Middleton        | [secure-local-secrets](#secure-local-secrets)                                                                                                                 |
| `message-020`   | Jacob Box                | [lean-service-selection](#lean-service-selection) [reduce-startup-resource-use](#reduce-startup-resource-use)                                                 |
| `reply-020-001` | Alex Woodhead            | [lean-service-selection](#lean-service-selection) [reduce-startup-resource-use](#reduce-startup-resource-use)                                                 |
| `message-021`   | Gareth (Gaz) Powell      | [arm64-images](#arm64-images)                                                                                                                                 |
| `reply-021-001` | Joel Clemence            | [arm64-images](#arm64-images)                                                                                                                                 |
| `reply-021-002` | Neil Shadrach            | [lean-service-selection](#lean-service-selection) [personal-remote-environments](#personal-remote-environments)                                               |
| `reply-021-003` | Tom Strickland           | Supports learning from existing remote workflows; covered by RAND-740/741 investigation and external cloud design.                                            |
| `reply-021-004` | Joel Clemence            | [lean-service-selection](#lean-service-selection) [personal-remote-environments](#personal-remote-environments)                                               |
| `reply-021-005` | Neil Shadrach            | [feature-flag-management](#feature-flag-management)                                                                                                           |
| `reply-021-006` | Neil Shadrach            | [feature-flag-management](#feature-flag-management)                                                                                                           |
| `reply-021-007` | Neil Shadrach            | [dotfiles-for-remote-environments](#dotfiles-for-remote-environments)                                                                                         |
| `reply-021-008` | Neil Shadrach            | [actionable-diagnostics](#actionable-diagnostics)                                                                                                             |
| `reply-021-009` | Martin Warnett           | [personal-remote-environments](#personal-remote-environments)                                                                                                 |
| `message-022`   | Stefano Basile           | [image-version-visibility](#image-version-visibility)                                                                                                         |
| `reply-022-001` | Stefano Basile           | Image attachment referenced in archive; text/metadata do not establish screenshot contents or a reproduced defect.                                            |
| `reply-022-002` | Christopher Gregory      | [image-version-visibility](#image-version-visibility) [local-automated-testing](#local-automated-testing)                                                     |
| `reply-022-003` | Tom Strickland           | [image-version-visibility](#image-version-visibility)                                                                                                         |
| `reply-022-004` | Christopher Gregory      | [image-version-visibility](#image-version-visibility)                                                                                                         |
| `reply-022-005` | Tom Strickland           | [image-version-visibility](#image-version-visibility)                                                                                                         |
| `message-023`   | Tom Strickland           | [versioned-service-configuration](#versioned-service-configuration)                                                                                           |
| `reply-023-001` | Jacob Box                | [versioned-service-configuration](#versioned-service-configuration)                                                                                           |
| `reply-023-002` | Tom Strickland           | [versioned-service-configuration](#versioned-service-configuration)                                                                                           |
| `reply-023-003` | Tom Strickland           | [versioned-service-configuration](#versioned-service-configuration)                                                                                           |
| `message-024`   | Martin Warnett           | [simplify-service-architecture](#simplify-service-architecture)                                                                                               |
| `reply-024-001` | Tom Strickland           | [simplify-service-architecture](#simplify-service-architecture)                                                                                               |
| `message-025`   | Tom Strickland           | [tester-friendly-interface](#tester-friendly-interface)                                                                                                       |
| `reply-025-001` | Neil Shadrach            | [windows-support](#windows-support)                                                                                                                           |
| `reply-025-002` | Tom Strickland           | [windows-support](#windows-support)                                                                                                                           |
| `reply-025-003` | Jacob Box                | [tester-friendly-interface](#tester-friendly-interface)                                                                                                       |
| `reply-025-004` | Neil Shadrach            | [local-automated-testing](#local-automated-testing)                                                                                                           |
| `reply-025-005` | Jacob Box                | [local-automated-testing](#local-automated-testing)                                                                                                           |
| `reply-025-006` | Tom Strickland           | [local-automated-testing](#local-automated-testing) [configurable-mocks](#configurable-mocks)                                                                 |
| `message-026`   | Tom Strickland           | [windows-support](#windows-support)                                                                                                                           |
| `message-028`   | Jacob Box                | [actionable-diagnostics](#actionable-diagnostics) [chs-dev-responsiveness](#chs-dev-responsiveness)                                                           |

System notices excluded from issue counts: `message-007`, `message-016`, `message-027`.
