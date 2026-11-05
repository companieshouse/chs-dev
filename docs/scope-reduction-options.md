# Scope reduction options for chs-dev

Status (2026-11-05): the Compose-only reduction has been implemented. Source
lines fell from 43,103 to 35,167 (7,936 fewer, 18.4%). See the
[upgrade guide](compose-transition.md) before switching an existing native
environment. The remaining options below are still proposals.

The largest source reductions come from narrowing the product to one runtime,
one interface and fewer built-in management tools. Refactoring alone is unlikely
to remove tens of thousands of lines.

These are options for discussion, not agreed implementation work.

## Baseline before Compose-only removal and estimates

The comparison used the local `chs-dev` and `chs-dev-legacy-reference` source
trees, counting only `src/` and excluding tests, dependencies and build output.

| Count                                         | Legacy |    New |
| --------------------------------------------- | -----: | -----: |
| Physical lines, including comments and blanks |  9,865 | 43,103 |
| Nonblank lines, including comments            |  8,303 | 41,247 |

Savings below use physical source lines, rather than a strict nonblank,
noncomment SLOC count. They are approximate net savings, allowing for related
wiring and replacement code. They have not been verified through deletion
branches. Options overlap and must not be added together.

## Options and tradeoffs

| Scope reduction                                             | Estimated saving | What you give up                                                                                                                  |
| ----------------------------------------------------------- | ---------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| Remove the TUI; keep CLI commands                           |           12–14k | Interactive screens, editors, navigation and modals                                                                               |
| Support Docker Compose only; remove native orchestration    |             7–8k | Native Docker orchestration and Apple containers; Compose handles scheduling and container lifecycle                              |
| Keep a much smaller TUI                                     |             5–7k | Keep service selection, start/stop and progress; remove secondary screens and editors                                             |
| Remove the daemon; run operations in the invoking process   |             4–6k | Work surviving frontend exit, reconnectable operations and shared clients; CLI lazy loading would need another persistent process |
| Drop Apple support, retain native Docker                    |             2–3k | Apple containers; overlaps with removing native orchestration                                                                     |
| Remove environment sharing and advanced version selection   |         1.5–2.5k | Import/export, CIDEV version snapshots, version-source selection and associated UI                                                |
| Make journeys file-defined; remove their interactive editor |         1.2–1.8k | In-app creation/editing; preserve selecting and starting journeys                                                                 |
| Remove the general container browser                        |           1–1.5k | Engine-wide listing, inspection and arbitrary container controls; use Docker tools                                                |
| Remove project discovery, cloning and settings editors      |           1–1.5k | Launch from the checkout; configure through files/environment                                                                     |
| Remove learned usage modes                                  |         0.4–0.7k | Automatic demotion of unused services; retain explicit lazy settings                                                              |

Removing native orchestration includes dropping Apple support. Removing the TUI
includes its journey editor, container browser and settings editors. The smaller
TUI estimate also includes several of those individual cuts.

## Strongest candidates

### Let Compose own orchestration

This is the largest backend reduction. The native implementation owns dependency
scheduling, readiness, reconciliation, images, networks, storage and platform
compatibility. Removing it deletes a whole responsibility. Supporting Apple
containers commits the project to maintaining much of that responsibility itself.

### Remove general-purpose administration tools

The container browser, inspection views, project finder, clone flow, settings
editors and SSH setup wizard expand the product beyond choosing and running a
development environment. Existing tools or short setup instructions can cover
these workflows.

### Keep configuration capabilities with simpler authoring

The journey screen has 1,347 lines, with another 592 lines in journey UI models.
A YAML file plus a simple journey selector preserves much of the value with
substantially less code. Environment profiles and detailed service settings offer
similar opportunities.

### Simplify automatic behaviour

Keep explicit service selection and explicit lazy/always settings. Remove learned
usage modes first. Removing auto-apply could also simplify the controller's
queues, polling and recovery; its saving has not been isolated. Configuration
changes would take effect through an explicit Apply action.

## Possible target scopes

| Target                 | Retained product                                                                              | Rough source target |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------: |
| Small interactive tool | Compose only; compact service/journey selector; start/stop/progress; file-based configuration |              23–29k |
| Maximum reduction      | Compose only; CLI only; direct operations; explicit configuration; no persistent lazy proxy   |              10–15k |

These targets are planning ranges, not measured deletion results. Removing the
daemon while retaining a TUI would restrict supervision and lazy proxy operation
to the lifetime of that process. Keeping operations and lazy loading alive after
the frontend closes requires a persistent process.

## Suggested first cut

Use Compose only, keep a compact TUI, make journeys and settings file-defined,
and remove the general container browser. This removes substantial scope while
preserving the main interactive development workflow.

If minimum source size is the overriding objective, pursue the CLI-only scope.
