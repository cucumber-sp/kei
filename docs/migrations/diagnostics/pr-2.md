# Brief: Diagnostics PR 2 — `untriaged` catch-all + codemod

## Context (read first)

You are a fresh Claude Code session implementing PR 2 of the
**Diagnostics module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — full design; especially
   §3 (discriminated-union shape), §4 (typed methods — the
   `diag.untriaged({...})` shape comes from here), §5 (collector
   — already constructed in PR 1, threading lands in PR 3), §9
   PR 2 (this PR), §9 PR 1 (predecessor)
3. `docs/migrations/diagnostics/pr-1.md` — PR 1 brief; describes
   the skeleton this PR populates
4. `CONTEXT.md` — domain glossary; "Diagnostic", "Collector",
   "Catalog", "untriaged" are load-bearing
5. `compiler/CLAUDE.md` — how to build / test / lint

PR 1 (skeleton) must be merged first. PR 3 (Collector threading)
follows immediately and is sequential — they're a tightly-coupled
pair. Do not start this PR before PR 1 lands.

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 2).

This is the BIG mechanical PR. The 162 hand-rolled
`new Diagnostic(severity, span, message)` call sites across the
checker get migrated in a single diff via a Bun codemod. The
migration is behaviour-preserving — `untriaged` carries a
`'TODO'` code that the formatter renders without a code prefix,
so user-visible output is byte-identical to today.

This is the equivalent of the Lifecycle migration's "PR 3 — pass
slot, no-op rewrite": introduce the catch-all variant first,
specialise it later (PRs 4a–4g).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — extend the (currently
  empty) union with one variant:
  `{ kind: 'untriaged'; code: 'TODO'; severity: Severity; span: Span; message: string }`.
  Envelope fields (`secondarySpans`, `notes`, `help`) per design
  doc §3 are present but optional and unused at this stage.
- `compiler/src/diagnostics/index.ts` — add the typed-method
  export `untriaged: (a: { severity: Severity; span: Span; message: string }) => …`
  per design doc §4. It routes through the Collector's `emit()`.
- `compiler/src/diagnostics/format.ts` — add the `case
  'untriaged':` arm. Renders `<severity>: <message>` at `<span>`
  with NO code prefix (advisory codes are not user-visible until
  PR 4a–4g; `'TODO'` is internal).
- `compiler/scripts/codemod-untriaged.ts` (new) — the Bun script
  that performs the bulk replacement. ~30–50 lines. Reads each
  target file, replaces `new Diagnostic(severity, span, message)`
  with `diag.untriaged({ severity, span, message })`, writes back.
  Commit alongside the bulk replacement so reviewers can audit.
- `compiler/src/checker/*.ts` — ~162 call sites mechanically
  rewritten by the codemod. No semantic change.
- `compiler/src/errors/diagnostic.ts` — kept; becomes a
  type-alias re-export of the new `Diagnostic` (or stays as-is
  if the union shape is structurally compatible). Removed in
  PR N+1.

**Out of scope (do not touch in this PR):**

- Don't add any other variants. The catalog stays at exactly one
  variant (`untriaged`) until PR 4a–4g land. This is the whole
  point of the staged migration.
- Don't change message wording at any call site. The codemod is
  mechanical, not semantic. If a message reads awkwardly, that
  belongs to the PR 4a–4g triage pass — file an issue if needed
  but don't fix it here.
- Don't merge with PR 3 (Collector threading). PR 3 is the
  plumbing change; this PR is the call-site rewrite. They're
  separate even though they're sequential.
- Don't delete `src/errors/diagnostic.ts`. PR N+1 owns that
  removal once `untriaged` is gone.
- Don't run the codemod by hand site-by-site. Write the script,
  run it, commit the script. Auditability matters more than
  shaving 50 lines off the diff.

## Behaviour preservation

`bun test` must pass with no test changes other than the new
tests this PR adds. Every existing assertion against checker
output must still hold — that's the whole behaviour-preservation
contract. If an existing test fails, the codemod has a bug;
fix the codemod, don't update the test.

The 162 sites land in one PR by design (§9 PR 2): the diff is
mostly mechanical, the test suite is the safety net, and a
fragmented multi-PR rewrite would leave the codebase in mixed
state for longer.

**New tests added by this PR:**

- `compiler/tests/diagnostics/untriaged.test.ts` — emit one
  `untriaged` diagnostic via `diag.untriaged({...})`, assert on
  the snapshot shape and the formatter output (no code prefix,
  message preserved verbatim).
- `compiler/tests/diagnostics/codemod.test.ts` — fixture-based.
  An input string with `new Diagnostic(severity, span, message)`
  patterns goes in; the codemod's transform function runs; the
  expected output string with `diag.untriaged({...})` comes
  out. Cover at least: simple call, multi-line argument, nested
  parens in the message expression.

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome runs in CI; the
  codemod must produce biome-clean output. If the rewrite leaves
  awkward formatting, fix the codemod to emit clean output, not
  a follow-up biome pass over the whole tree.
- **Don't introduce new dependencies.** No AST library —
  regex/string replacement is enough for this rewrite. If you
  reach for `ts-morph` or `@babel/parser`, stop and report.
  `package.json` must not change.
- **Don't add a kind variant beyond `untriaged`.** Even one extra
  variant defeats the staged-migration plan. PR 4a–4g do that.
- **Don't widen the codemod's scope.** It rewrites
  `new Diagnostic(...)` only. Other refactors of the checker
  files are out of scope; file an issue if you spot one.
- **Don't drop the `severity` argument.** Every existing call site
  passes severity explicitly; the codemod preserves it. Severity
  resolution via the catalog is a PR 4a–4g concern (the
  `untriaged` variant takes severity per-call by design — it's
  the catch-all, not a real catalog entry).
- **Don't skip running `bunx biome check` after the codemod.**
  If it fires, the codemod's output is wrong.

## Implementation steps

1. Extend `src/diagnostics/types.ts` with the `untriaged`
   variant (one arm in the union; envelope fields optional).
2. Extend `src/diagnostics/index.ts` with the `untriaged`
   typed-method per design doc §4.
3. Extend `src/diagnostics/format.ts` with the `case 'untriaged':`
   arm. No code prefix, message rendered verbatim.
4. Write `compiler/scripts/codemod-untriaged.ts`. Bun script,
   reads file paths from CLI args (or globs `src/checker/*.ts`),
   applies the regex/string transform, writes back. Keep it
   small — 30–50 lines.
5. Add `tests/diagnostics/codemod.test.ts` with fixture input
   and expected output. Run before pointing it at real files.
6. Run the codemod against `src/checker/*.ts`. Confirm the diff
   is mechanical — no semantic changes, no dropped arguments,
   no message edits.
7. Run `bun test`. All existing tests must pass. If any fails,
   diagnose the codemod's output for that site, fix the codemod,
   regenerate.
8. Run `bunx biome check src/ tests/`. Must be clean.
9. Add `tests/diagnostics/untriaged.test.ts` for the new
   variant's emit/format path.
10. Commit the codemod script + the bulk replacement together.

## Verification recipe

```bash
cd compiler
bun install
bun run scripts/codemod-untriaged.ts  # idempotent — re-running is a no-op
bun test                              # must pass with no regressions
bunx biome check src/ tests/          # must report no issues
```

If any step fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style:

```
feat(diagnostics): add `untriaged` catch-all variant + typed method
chore(diagnostics): add codemod script for `new Diagnostic` → `diag.untriaged`
refactor(checker): migrate 162 call sites to `diag.untriaged` via codemod
test(diagnostics): cover `untriaged` emit/format and codemod transform
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 2 of 6)
  for the Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds `untriaged` catch-all variant + `diag.untriaged({...})`
  typed method
- Codemod (`scripts/codemod-untriaged.ts`) rewrites the 162
  `new Diagnostic(...)` call sites in `src/checker/*.ts`
- `src/errors/diagnostic.ts` kept as transition alias (removed
  in PR N+1)
- Behaviour-preserving: `bun test` passes unchanged

## Test plan
- [ ] `bun test` passes (no regressions across ~1,900 tests)
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/untriaged.test.ts` covers emit + format
- [ ] `tests/diagnostics/codemod.test.ts` covers the transform
      with fixture input/output
- [ ] Codemod is idempotent (re-running produces no diff)
```

Diff size note: ~500 lines of mostly-mechanical replacement.
Reviewer focus: the codemod logic and a handful of representative
call-site diffs, not every replacement.

## Escape hatches

Stop and report if:

1. The codemod's regex/string approach can't disambiguate a call
   site (e.g. `new Diagnostic` is shadowed in scope, or an
   argument expression contains an unbalanced literal). An AST
   approach is a design-doc-level decision, not a brief-level
   one.
2. A test fails after the codemod and the failure isn't
   reproducible by reverting that single site to its pre-codemod
   form (suggests a subtler interaction).
3. The diff exceeds ~700 lines (suggests the codemod is doing
   more than the design doc anticipated).
4. You discover a call site that doesn't fit the
   `new Diagnostic(severity, span, message)` shape — e.g. an
   inheritor or builder pattern. Design doc says all 162 sites
   match; if they don't, that's a design-doc problem.

Report format per `_brief-template.md`.
