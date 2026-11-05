# Code quality

Follow [docs/code-quality.md](docs/code-quality.md). Keep changes focused and
functions responsible for one clear operation.

- **Never add avoidable nesting.** Use guard clauses and early `return` or
  `continue` to handle invalid inputs, errors and skipped work before the main path.
- Keep callbacks shallow. Use named handlers and extract parsing, validation or
  individual operations into helpers at module scope or a shallower function
  boundary. Naming a function inside a deeply nested block does not reduce depth.
- Count callbacks and control flow together: a callback → loop → callback → `if`
  has depth 4. Prefer flat orchestration; JSX layout and indentation do not count.
- Treat limits as ceilings, not targets: combined nesting, control-flow and
  callback depth ≤3; cyclomatic complexity ≤10; functions ≤80 nonblank/noncomment
  lines; parameters ≤5. Review large JSX functions before splitting them.
- Keep the complexity baseline empty. Fix responsibilities instead of raising
  thresholds, adding allowances or suppressing rules. Audit ignores inline ESLint
  suppressions. Refresh the baseline only after reviewing a report with no findings.
- Keep domain code independent of implementation and frontend layers. Respect
  architecture boundaries and React hook rules; review hook dependency warnings.
- Review duplication, side effects, error handling and testability when extracting
  helpers; do not split code solely to satisfy a metric.
- Use four spaces, no tabs, LF, single quotes and semicolons. Separate functions
  and meaningful steps with one blank line; keep related statements together.
- Run `npm run check` and `npm test` before completing code changes. Use
  `npm run complexity:report` to investigate findings; run
  `npm run test:complexity` when changing audit rules or tooling.

## Agent skills

### Issue tracker

Issues and specs for this repo live as local Markdown under
`.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Skills use the five canonical triage roles as literal label names
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context domain-doc layout. See `docs/agents/domain.md`.
