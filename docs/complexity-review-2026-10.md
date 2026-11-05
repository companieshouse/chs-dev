# Code Review: Remaining Complexity & Messiness

> **Date:** 2026-10-02 · **Scope:** read-only review, no changes made
>
> All ESLint thresholds (complexity ≤15, ≤100 lines/function, depth ≤4) now pass everywhere. The findings below are _near-threshold_ hotspots (complexity ≥12 / ≥85 lines / depth ≥4 — 123 strict-mode findings remain) plus qualitative "messiness" verified against the code by four parallel review agents.

## 🔴 Top concerns (ranked)

| #   | Location                                                        | Issue                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/application/live-controller.ts:312–355`                    | `start()`'s inner closure is a **near-verbatim fork of `resolveRevision()`** (903–948) that has already diverged (drops `lock()`, `lastRead`, revision event); the drift error message is copy-pasted **3×** (325, 847, 1022) with different wording |
| 2   | `src/tui/components/service-modal.tsx:84–116, 539–630, 632–668` | `useServiceModalState` returns a **45-property object**, hand-copied field-by-field into a 22-member `ModalKeyContext`, then spread wholesale into the view — extraction seams that narrow nothing                                                   |
| 3   | `src/tui/app.tsx:641–663`                                       | `AppModel` **22-field god-object** passed to all 6 render components — the hook split bought no locality; `useGlobalKeys` handler is at the complexity cap (526–561)                                                                                 |
| 4   | `src/server/bootstrap.ts:258–349`                               | 92-line `createApplication` with **two copies of a quadruple-nested try/finally shutdown ladder** that can drift apart                                                                                                                               |
| 5   | `src/infrastructure/native/portable-chs.ts:441–551`             | `runScript`+`executeTask`: legacy digest computed twice, error handling embedded mid-failure-path, `TaskRecord` mutated across 3 helpers                                                                                                             |
| 6   | `src/infrastructure/native/apple-adapter.ts:853–935`            | `containers.action` (~83 lines): stop command **and** control persist each implemented **twice** in different branches                                                                                                                               |
| 7   | `src/infrastructure/native/portable-chs.ts:782–883`             | `routing` threads an **`any`-typed `http` bag** through 3 mutating helpers; depth-4 nested ternary                                                                                                                                                   |
| 8   | `src/infrastructure/native/portable-compiler.ts:175–228`        | `envFile` (cx ~13, depth 4): duplicate dynamic `RegExp`, loop-index mutation inside quote-continuation, env merge built twice                                                                                                                        |
| 9   | `src/infrastructure/ssh-setup.ts:413–470`                       | `installSecrets`: **triplicated** cleanup blocks, write-before-check ordering, redundant state flags                                                                                                                                                 |
| 10  | `src/tui/components/environment-panel.tsx:303–304, 520–523`     | "Selected action" has **3 representations** (id / index / -1→0 collapse) — the trickiest state flow found                                                                                                                                            |

## Systemic patterns (fix the pattern once, not per-file)

### 1. Deps/context god-objects

The dominant refactor artifact: 8 hooks/contexts take 12–45 field bundles of mostly setters:

- `LogsInputDeps` — 16 fields (`logs-screen.tsx:48–65`)
- `PanelKeyboardDeps` — 17 fields (`environment-panel.tsx:95–114`)
- `ModulesInputDeps` — 19 fields (`modules-browser.tsx:21–41`)
- ssh-setup flow object — 19 fields incl. leaked raw setters (`ssh-setup-modal.tsx:80–146`)
- `ServicesKeyContext` — 12 fields (`services-screen.tsx:23–39`)
- `useContainersKeys` — 16 fields (`containers-screen.tsx:74–108`)
- `useServiceModalState` — 45 properties (`service-modal.tsx:539–630`)
- `useDetailKeys` — 12 params (`container-details.tsx:169–196`)

Handlers could just close over component state; the bundles hide data flow behind pass-through objects.

### 2. Duplicated logic clusters

- Centered-window math **×4** — `service-modal.tsx:251`, `containers-screen.tsx:172`, `environment-panel.tsx:218`, `models/modules.ts:47`
- Async busy/notice action pattern **×3** — `service-modal.tsx:263, 286`, `container-details.tsx:118`
- Search-text editing **×2** — `modules-browser.tsx:86–89` vs `containers-screen.tsx:132–136` (plus duplicated filter-header JSX)
- Compose readiness predicate **×2, verbatim** — `runtime.ts:472–474` and `637–639`
- Busy-allowlist command lists **×2** — `project-session.ts:272–277` and `325–330`
- Hand-rolled modal frames **~4×** — duplicating `modal-frame.tsx` (ssh-setup-modal, aws-login-modal, service-logs)
- `editValue` duplicates `editText` (`ssh-setup-modal.tsx:148–156` vs `text-input.ts:7–19`)
- First-IPv4-from-addresses expression **×6** in `portable-chs.ts` (326, 327, 686, 694, 757, 768, 912)
- `!s.initialization` filter **×5**, docker.sock mount filter **×3** in `portable-chs.ts`
- Drift error message **×3** with inconsistent wording — `live-controller.ts:325, 847, 1022`
- Cancelled/success classifier duplicated — `interactive-command.ts:80` and `:96`
- `if (signal?.aborted) throw error` catch preamble — `aws-profiles.ts`, `apple-client.ts` ×4, `ssh-setup.ts`

### 3. Stringly-typed state

- `service-modal.tsx` busy labels round-trip through display strings (`'Restarting…'` set at 269–271, compared at 172–185, `…` stripped at 478) — a `{busy: action, label}` state would kill the coupling
- Container lifecycle lists duplicated: `['running','restarting']` / `['paused','removing','dead']` (`container-details.tsx:369–374`) vs `app.tsx:55` — belong in `domain/containers`

### 4. Untyped boundaries

- `http: any` bag mutated across 3 helpers — `portable-chs.ts:718–722, 782–834, 836–845, 865–883`
- `Promise<any>` public API — `apple-image-metadata.ts:22` (the `{Volumes, Healthcheck, Shell}` contract is enforced nowhere)

### 5. Fragile effect wiring

`app.tsx:438–473` — `alertDeferred` re-implements the `loginOverlayOpen` predicate; effects depend on per-render-unstable `ui`/`onAlert` identities so dedup relies entirely on refs; `useAutoLogin`'s 11-dep array + latest-ref (`:384–432`) shares the same fragility.

## ⚠️ Possible behavioral bugs (worth tickets)

- `service-modal.tsx:318–334` — `runApply` leaves `busy` latched on success; the modal stays key-locked unless the parent closes it (implicit contract).
- `container-details.tsx:90, 113` — polling effect double-triggers on action completion (both `busy` and `revision` change); spinner re-flashes every 5s on healthy containers.
- `environment-panel.tsx:520–523` — "nothing selected" renders identically to "first row selected" (`findIndex` −1 → 0).

## Clean bill of health

`service-logs.tsx`, `aws-login-modal.tsx` (minor notes only), `tab-bar.tsx` / `enabled-browser.tsx` (trivial), `compiler.ts` (low-severity only), `operations.ts` (medium-low only).

## Dead code

- `logs-screen.tsx:23–24` — `noopSubscribe` and `emptySnapshot` are referenced nowhere in `src/`; delete.

## Suggested next steps

1. **Quick wins (~10 small extractions killing ~15 duplications):** delete dead code; extract `useGenerationCache` (app.tsx:137–178), shared `viewport()` windowing helper, `useModalSave`, `unlinkQuietly` (ssh-setup), `unavailable()` (apple-client), shared readiness predicate (runtime.ts), `effectiveExclusions` (service-modal), shared lifecycle predicates.
2. **De-duplicate the two genuinely forked paths** — `live-controller.start` vs `resolveRevision` (already diverged), and `bootstrap.createApplication`'s twin shutdown ladders. Highest correctness risk.
3. **Type the `any` bags** — portable-chs `http` model, `apple-image-metadata` return.
4. **Consolidate the deps-bundle pattern** into closure-based handlers or a small `useKeyMap` abstraction — biggest structural payoff across the TUI.

## Near-threshold strict-mode hotspots (context)

Running ESLint with tightened limits (`complexity: 10`, `max-lines-per-function: 80`, `max-depth: 3`) reports 123 findings. Files with the most:

| File                                             | Findings |
| ------------------------------------------------ | -------- |
| `src/infrastructure/native/portable-chs.ts`      | 8        |
| `src/tui/components/service-modal.tsx`           | 8        |
| `src/application/live-controller.ts`             | 5        |
| `src/infrastructure/native/apple-adapter.ts`     | 5        |
| `src/infrastructure/native/compiler.ts`          | 5        |
| `src/infrastructure/native/portable-compiler.ts` | 5        |
| `src/infrastructure/ssh-setup.ts`                | 5        |
| `src/tui/app.tsx`                                | 5        |

## Resolution — 2026-10-02

The original review and source locations above describe the pre-refactor snapshot.
All 123 strict-mode findings are resolved. The checked-in
[complexity audit](complexity-audit-2026-10.json) retains each original location,
rule and measurement with its resolution. ESLint now permanently uses complexity
10, function length 80 nonblank/noncomment lines, and nesting depth 3. The
complexity baseline is empty, and the audit ignores inline suppressions.

| Concern                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start / Apply divergence and drift messages | Both paths resolve immutable revisions under the same ownership lock, update revision bookkeeping, validate identity and use one drift failure. Start retains its SSH check before preview.                                                                                                                                                                                                                             |
| Bootstrap teardown                          | One ordered shutdown helper attempts every cleanup and retains the original initialization failure alongside cleanup failures. Normal close also flushes state.                                                                                                                                                                                                                                                         |
| Native task, script and discovery paths     | Task execution owns its record; log buffering, diagnostics and checkpoint reuse are separate. Digests are calculated once, and discovery HTTP routes and monitoring targets have explicit types.                                                                                                                                                                                                                        |
| Compiler and image boundaries               | Environment-file quoting and command-word state have focused parsers. Interpolation merges the environment once per value. Image metadata validates unknown cache/archive data before exposing volume, healthcheck and shell defaults.                                                                                                                                                                                  |
| Apple actions and SSH installation          | Stop/control persistence share helpers. SSH repair checks precede installation; rollback tracks created paths and attempts all cleanup after failures.                                                                                                                                                                                                                                                                  |
| TUI dependency bundles and AppModel         | Input handlers own state or use typed transitions and semantic actions. Screens and overlays receive scoped inputs instead of the whole AppModel. Service configuration, navigation, operations and presentation have separate owners.                                                                                                                                                                                  |
| Shared TUI and runtime logic                | Centered windows, text editing, search headers, modal frames, guarded async actions, container lifecycle predicates, readiness policies, cancellation handling, busy command allowances and generation caches are reused. Dead log subscriptions are removed.                                                                                                                                                           |
| Effect wiring                               | Login callbacks and AWS refresh are stable; automatic login observes primitive flags. Failure alerts share the overlay predicate and use stable callbacks.                                                                                                                                                                                                                                                              |
| Confirmed TUI bugs                          | Service save closes the modal itself and releases busy on all outcomes; busy input is consumed. Container actions refresh once, periodic polling retains details, and stale responses cannot replace a new selection. Environment action IDs preserve an empty selection after clear/disappearance: Enter does nothing until Down selects the first row or Up selects the last. The initial first row remains selected. |

Validation: all 255 unit/regression tests pass; formatting, lint, the zero-baseline
complexity gate, type checks and the production build pass. The added regressions
cover immutable preview/ownership, shutdown failures, SSH rollback and repair
ordering, metadata cache/archive validation, compiler quoting, exact complexity
limits, service-save completion/retry, container polling and Environment selection.
Docker core integration (4 enabled tests), Docker platform selection, and compiler
parity with Docker Compose pass. Apple core, image defaults, platform recovery,
development/reload and Kafka integration pass (5 tests).

The initial Apple CHS ingress check received a corporate proxy block page rather
than the local service response. Rerunning it with `CHS_APPLE_INTEGRATION=1`
and `CHS_APPLE_GUEST_HTTP=1` passes, verifying initialization, ingress discovery,
updates and retained data through the guest network.
The additional Docker CHS Mongo/Kafka tests stop at ownership preflight because
existing containers occupy the exact names `mongo` and `zookeeper`. Those checks
require an engine where those names are free.

## Combined nesting follow-up — 2026-10-02

The new `local/combined-nesting` rule enforces a shared maximum depth of 3 for
nested functions and control-flow blocks. Callback boundaries no longer reset
the control-flow count. The existing depth, callback, complexity and function
length limits remain enforced. The rule participates in the reports and the
empty-baseline gate in `npm run check`; inline suppression cannot bypass it.
[Code quality guidance](code-quality.md) defines the exact counting rules.

The first combined audit found 39 additional findings across 22 production files.
All are resolved, with their original locations and resolutions retained in the
[combined nesting audit](combined-nesting-audit-2026-10.json). Response callbacks
delegate to readers, SSE framing and parsing have a separate decoder, and polling
shares scheduling and cancellation. Validation, ownership, traversal and async
input paths use named operations or early returns at shallower boundaries.
No thresholds or baseline allowances were increased.

Validation: all 275 unit/regression tests pass, including mixed-nesting boundaries,
the CLI gate, split UTF-8 event frames, malformed responses, buffer limits,
cancellation, single-close notification and serial polling. Formatting, lint,
the zero-baseline gate, type checks and the production build pass. Docker core
integration passes all four enabled tests (six optional checks skipped). The
targeted Apple core test passes DNS, dependency ordering, jobs, lifecycle and
retained-volume checks.
