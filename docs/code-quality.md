# Code quality checks

Run `npm run check` to run formatting, lint, the complexity baseline gate, and
TypeScript type checks. Run `npm test` separately for application and tooling tests.

`npm run lint` checks production code, tests, scripts, and the ESLint configuration.
Correctness errors cover unsafe Promise executors, unsafe finally blocks, constant
binary expressions, duplicate branches/cases, missing array callback returns,
switch fallthrough, loose equality (except null comparisons), mutable declarations
that can be constants, `var`, and `debugger`. React hook call rules are errors;
hook dependency findings are warnings pending review. Domain imports from
implementation and frontend layers are errors. Existing architecture tests also
check other boundaries and dynamic imports.

`npm run lint:fix` applies available automatic fixes. Inline ESLint comments are
honoured by normal linting, including the documented hook dependency exception.
Complexity rules run only on production TypeScript and TSX.
Run `npm run complexity:report` for source locations, measured rule violations,
and review suggestions, ranked by warning count per file. Function rules include
function names where ESLint can infer them. `npm run complexity:json` emits the
same findings as JSON for further analysis.

Thresholds are combined nesting depth 3, control-flow depth 3, cyclomatic
complexity 10, function length 80 nonblank/noncomment lines, callback depth 3,
and 5 parameters. Nesting measures code structure rather than whitespace or JSX
layout. Large JSX functions need manual review before deciding whether to split
them. These signals identify review candidates; they do not prove that code is
poorly written.

The `local/combined-nesting` rule shares one counter across nested functions
and control flow. A top-level function body adds no depth. Each nested function
(callback or named local function), `if`, loop, `switch`, or `try` adds one, and
nested functions inherit the enclosing depth. An `else if` chain counts as one
conditional; `catch` and `finally` share the depth of their `try`. Ordinary blocks,
JSX, types, ternaries and wrapped arguments add no depth. Class methods and static
initializers act as function boundaries. The rule reports the first depth-4 node
on each path without cascading warnings inside it.

For example, a callback containing a loop containing another callback containing
an `if` has combined depth 4, even though the separate callback and control-flow
limits accept it. Prefer guard clauses, named handlers at the containing function
level, and helpers that own parsing, validation or one operation. A named function
declared inside the same deeply nested block still inherits that depth; move the
responsibility to a shallower boundary. In `src/client/connection.ts`, HTTP response
handlers delegate to response readers, and `src/client/event-stream.ts` owns SSE
framing and parsing.

`npm run complexity:check` fails if warning counts increase for any file/rule
pair or if parsing or a correctness check fails. Hook dependency warnings are
excluded from the complexity counts. The baseline is empty after the October
2026 complexity cleanup, so every new production complexity warning fails this
gate. Keep the baseline empty; split responsibilities instead of adding
allowances or increasing thresholds. Review the report alongside changes for
mixed responsibilities, duplication, side effects, error handling and testability.

Run `npm run complexity:baseline` only after reviewing the report and confirming
it has no findings. Commit the empty baseline with the relevant change. Do not
regenerate it automatically in CI. CI should run `npm run complexity:check`
alongside type checks and tests. The original 123 findings and their resolutions
are recorded in [the October audit](complexity-audit-2026-10.json).
The additional 39 mixed-nesting findings and their resolutions are recorded in
[the combined nesting audit](combined-nesting-audit-2026-10.json). Its baseline is
also empty.

The syntax parser uses Babel's TypeScript support independently of the project's
TypeScript compiler version. `npm run typecheck` remains the type validation.
Run `npm run test:complexity` to verify the audit rules, TS/TSX parsing, and
baseline acceptance and failure cases.

Rule definitions: https://eslint.org/docs/latest/rules/

Inline ESLint suppression comments are ignored for this complexity audit.

## Formatting

Prettier and EditorConfig use four spaces, no tabs, and LF line endings. Prettier
also uses single quotes and semicolons. `npm run format` applies formatting;
`npm run format:check` checks it without modifying files. Generated `dist`,
`node_modules`, and `tmp` directories are excluded. VS Code settings enable
Prettier on save and recommend the Prettier and ESLint extensions.

Use one blank line between functions and class methods, and between meaningful
steps within longer functions. Separate guard clauses from the main path, setup
from execution, and execution from result handling. Keep related assignments,
object members, and short sequences together. Avoid adding a blank line after
every statement. Prettier preserves intentional single blank lines, so add the
logical grouping when editing code.

Run `npm run indent:report` to list the 20 source files with the largest physical
indents, or `npm run indent:report -- 10` to choose how many files to show. Each row
reports the maximum number of literal leading spaces and the first `src/file:line`
where it occurs. Ties sort alphabetically. Blank lines are ignored, and tabs are
not expanded. Empty files report zero spaces with `-` for the line number. The
script also runs directly as `node scripts/indentation.mjs [limit]` and locates
`src` relative to itself, independently of the working directory.

Run `npm run length:report` to list the 20 longest source files, or
`npm run length:report -- 10` to choose how many files to show. Each row reports
the total physical line count and `src/file`, ranked by line count with
alphabetical ties. Blank lines and comments count; empty files have zero lines,
and a trailing newline does not add a line. LF and CRLF line endings are supported.
The script also runs as `node scripts/file-length.mjs [limit]` and locates `src`
relative to itself, independently of the working directory.

Type-aware rules such as `no-floating-promises`, `no-misused-promises`, and
`switch-exhaustiveness-check` remain deferred until the TypeScript lint parser
supports the project's TypeScript compiler version. Babel provides syntax checks;
it does not supply TypeScript type information.
