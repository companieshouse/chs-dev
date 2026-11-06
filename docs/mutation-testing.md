# Mutation testing

Mutation testing checks whether tests detect deliberately changed behaviour. The
local runner changes one expression in a disposable copy, runs the selected real
tests, records the result and restores that copy. It never mutates the working
source tree. It uses the existing Babel dependency; no package installation or
external service is required.

On this macOS development copy:

```sh
npm run test:mutation -- --list
npm run test:mutation
```

The checked-in configuration selects fourteen modules directly exercised by the
unit command and its ten test files. The full run is deliberately slower than
ordinary tests. For a smaller campaign, copy `scripts/mutation-unit.json`, narrow
`files` and `tests`, choose a fresh `outputDirectory`, then run:

```sh
node scripts/mutation-test.mjs --config path/to/config.json
node scripts/mutation-test.mjs --config path/to/config.json --only-ids MUTANT_ID
```

Use a fresh output directory when retaining earlier evidence: repeating a run
replaces that directory's manifest, report and matching logs. `--list` generates
the manifest without executing tests. Unknown IDs fail before execution.

Each campaign first requires an unmodified passing baseline. Tests execute
through `scripts/test-local.mjs`, with outbound network denied and isolated
configuration. The runner copies the current source and tests, including
uncommitted edits, excludes `.git`, build output and scratch directories, and
temporarily links the already installed dependencies. Its report includes source
and selected-test hashes, stable mutant IDs, exact edits, individual TAP logs,
durations and completion state. Disposable copies and dependency links are
removed on completion. Timeout handling terminates the test process group; its
own fixture tests verify that both the worker and a spawned descendant exit.

The supported mutations flip booleans, swap `&&`/`||`, negate comparisons, change
relational boundaries, force conditional/loop guards and remove logical negation.
Type-only syntax, comments and duplicate edits are excluded. This is a scoped
operator set, not all possible faults: arithmetic, string, nullish-coalescing,
statement-removal and call-removal mutations are not generated. Passing mutants
can also reveal equivalent behaviour, unreachable defensive branches or coverage
provided by a different test suite.

Results distinguish:

- **Killed:** a real test assertion or uncaught error inside a named test detects
  the change.
- **Survived:** the selected suite still passes; investigate the public behaviour.
- **Timeout:** the test process exceeded the deadline; never counted as an
  assertion detecting the mutation.
- **Invalid:** source/transform or module-loading failure prevents meaningful
  execution.
- **Infrastructure error:** setup, teardown, cancelled tests or incomplete test
  execution prevents a conclusion.

The strict reported score is `killed / (killed + survived)`. It retains equivalent
survivors and excludes timeouts, invalid mutations and infrastructure failures;
always read the counts alongside it. Exit code 2 means a baseline/configuration
problem or an inconclusive mutation result. Exit code 0 permits survivors and is
not a quality threshold.

The runner's public CLI is itself tested using tiny fixture projects and the real
Node test runner. Those fixtures inherit the outer local sandbox, because macOS
cannot apply a second sandbox inside it. They do not weaken or skip the
repository's local sandbox. Run them with:

```sh
node scripts/test-local.mjs test/mutation-tooling.test.mjs
```

## Recorded campaign

The November 2026 campaign compares the exact original unit suite at `8f94e14`
with the strengthened suite at `fd100a0`. Both consolidated runs evaluate every
one of the same **1,241 mutations** across fourteen modules, with the same
10-second watchdog. Original and final application-source hashes match.

The strict score improves from **52.5% to 90.7%**. The original run catches 644
mutations, with 583 survivors and 14 timeouts. The final run catches 1,111, with
114 survivors and 16 timeouts. Neither has invalid mutations or infrastructure
failures. **469 original survivors are now caught**; two previously failing loop
mutations become timeouts because new empty-input cases expose nontermination.
They remain unscored.

| Area                                       | Mutations | Caught before | Caught after | Final survivors | Final timeouts |
| ------------------------------------------ | --------: | ------------: | -----------: | --------------: | -------------: |
| Configuration, dependencies and navigation |       149 |            93 |          148 |               1 |              0 |
| Lifecycle domain helpers                   |       124 |            37 |          122 |               0 |              2 |
| Shared lifecycle controller                |       575 |           306 |          463 |             103 |              9 |
| Runtime, processes, environment and files  |       301 |           154 |          290 |               6 |              5 |
| Interactive commands and logging           |        92 |            54 |           88 |               4 |              0 |
| **Total**                                  | **1,241** |       **644** |    **1,111** |         **114** |         **16** |

These are consolidated results against the full unit-test cohort: 91 original
tests and 199 strengthened tests. Earlier scoped diagnostic runs used smaller
test selections and sometimes a five-second watchdog, so their counts can differ.
The table uses only the consistent final comparison.

Sol 6.1 agents built the runner, investigated the domain/controller/runtime
survivors and independently reviewed the new assertions. The orchestrator covered
interactive commands, logging and the consolidated audit. Added tests exercise
public interfaces with injected external dependencies or isolated local files
and processes. Actual mutant failures demonstrate sensitivity to recovery and
manual holds, cancellation, retained environment ownership, failed operations,
credential/privacy handling, dependency trees and safe log storage. Independent
review corrected both false equivalence claims and result-classification bugs.
Application logic was not changed.

The full sandboxed regression suite passes **719 tests**, with two intentional
live Microcks skips and zero failures. This adds 108 unit tests and ten runner
tests to the prior 603-test suite. Formatting, lint, complexity (zero warnings),
type checking and build pass. The runner's golden test checks exact transformed
source, and its CLI fixtures cover baseline refusal, real assertion/error kills,
survivors, invalid/setup failures and termination of a worker plus descendant.

## Remaining limits and evidence

All 114 survivors remain in the strict score. Their reviewed classifications
comprise 54 diagnostic-only changes, 21 defensive checks or extra-work paths,
23 equivalent/unreachable cases or equivalence candidates, and **16 explicitly
retained coverage gaps**. Those gaps include unusual non-Error failures, default
OS signal errors, asynchronous Stop/release and SSH continuation ordering,
concurrent shutdown verification, login admission, late/stopped observation and
correlation object-key presence. These are gaps in the assertions, not proof
that unchanged production code is defective. Defensive and diagnostic cases are
also retained; there is no equivalence-adjusted headline score.

The checked-in [detailed results](mutation-results.json) contain source and test
hashes, per-file counts, every remaining mutant's exact edit and explanation,
and acceptance evidence. The audit independently reclassified all 2,482 raw
mutant outcomes and verified that all 2,484 recorded baseline/mutant process
groups were absent after completion. Post-timeout signal warnings remain
recorded; workspace removal alone was not treated as proof of process cleanup.

Raw reports, manifests, TAP logs, scoped red/green runs and independent review
notes remain in `.scratch/mutation/`. Original-suite exports and mutation source
copies were removed, including their dependency links. Scratch data is untracked
and may be excluded by the later sync helper; the checked-in report preserves the
results needed for that handoff. No sync or remote operation was performed.

The source/operator limits described above still apply. This is not a mutation
score for the entire repository, a guarantee against all bugs, or validation of
live Docker/AWS/services.
