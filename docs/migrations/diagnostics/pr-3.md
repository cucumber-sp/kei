# Brief: Diagnostics PR 3 — wire `Collector` through `Checker`

## Context (read first)

You are a fresh Claude Code session implementing PR 3 of the
**Diagnostics module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — full design; especially
   §5 (collector — "constructed and threaded (b)", explicitly
   not a singleton), §9 PR 3 (this PR), §9 PR 2 (predecessor)
3. `docs/migrations/diagnostics/pr-2.md` — PR 2 brief; the
   codemod that already routed every call site through
   `diag.untriaged({...})`
4. `CONTEXT.md` — domain glossary; "Collector" is a value, not a
   singleton — design doc §5 is emphatic about this
5. `compiler/CLAUDE.md` — how to build / test / lint

PR 2 must be merged first. PRs 4a–4g (specificity) start once
PR 3 lands and are parallelizable across categories.

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 3).

Plumbing change. The `Collector` becomes constructed-and-threaded
per design doc §5(b). Today's `Checker` holds its own diagnostic
list; after this PR, `Checker` holds a `Collector` reference and
the CLI driver constructs the Collector and passes it in.

The actual call sites in checker files don't change — PR 2's
codemod already routed them through `diag.untriaged({...})`
which goes through the Collector. This PR makes the routing
*explicit at the Checker boundary* rather than implicit via
module-level state.

**Files affected:**

- `compiler/src/checker/checker.ts` — replace the `diagnostics:
  Diagnostic[]` (or equivalent `errors`) field with `collector:
  Collector`. Constructor accepts a `Collector` (or a
  `Diagnostics` from `createDiagnostics(config)`, depending on
  the typed-methods shape PR 1 settled on). The
  `checker.diagnostics()` snapshot accessor delegates to
  `collector.snapshot()` (or whatever PR 1 named it).
- `compiler/src/cli/...` (or `compiler/src/cli.ts` — locate the
  driver) — construct the Collector via `createDiagnostics({})`,
  pass into `new Checker(ast, diag)`, render output via the
  formatter from the snapshot.
- Any other `new Checker(...)` construction site (test helpers,
  REPL, fixtures) — update to pass the Collector. Use a shared
  `tests/helpers/checker.ts` helper if one already exists rather
  than copy-pasting construction.

**Out of scope (do not touch in this PR):**

- Don't change call sites inside checker files — they already
  call `diag.untriaged({...})` after PR 2's codemod. Touching
  them again is scope creep.
- Don't introduce a module-level singleton Collector "for
  ergonomics". Design doc §5 forbids it explicitly; §10.1
  documents the rejection. If you feel the urge, stop and
  report — it's a design-doc-level decision, not a brief-level
  shortcut.
- Don't keep a backup `diagnostics` field on `Checker` for
  transition. Rip it out cleanly. The Collector is the single
  source of truth from this PR onward.
- Don't restructure `Checker` beyond the minimum needed for the
  Collector wiring. If `Checker` looks tangled, file an issue
  per repo policy and move on.
- Don't add new variants. The catalog stays at `untriaged` until
  PR 4a–4g land.

## Behaviour preservation

`bun test` must pass with no test changes other than the new
tests this PR adds, plus mechanical updates to test helpers that
construct `Checker` (which now require a Collector argument).
Helper-update churn is allowed; assertion churn is not. If an
assertion changes, that's a regression — diagnose, don't update.

**New tests added by this PR:**

- `compiler/tests/diagnostics/collector-isolation.test.ts` —
  through-Checker integration test:
  - Construct two `Checker`s with two distinct `Collector`s.
  - Run both against compilable inputs that emit at least one
    diagnostic each.
  - Assert: each Collector's `snapshot()` contains only the
    diagnostics from its own Checker. No cross-talk.

PR 1's `tests/diagnostics/collector.test.ts` already covers
isolation at the Collector level; this PR adds the integration
layer through `Checker`.

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in this PR's scope should appear.
- **Don't introduce new dependencies.** `package.json` must not
  change.
- **Don't add a singleton.** See "Out of scope". Design doc §5
  is the controlling decision.
- **Don't keep a transition `diagnostics` field on Checker.**
  Two sources of truth is exactly what this PR removes.
- **Don't widen scope to "while I'm in here, fix Checker's
  constructor".** File issues per repo policy; don't carry
  unrelated cleanup in this PR.
- **Don't skip the isolation integration test.** It's the one
  test that proves this PR did what it claimed at the
  Checker boundary, not just the Collector boundary.

## Implementation steps

1. Add `collector: Collector` field to `Checker` (or the
   `Diagnostics` typed-methods object — match PR 1's exported
   shape). Remove the existing `diagnostics` / `errors` field.
2. Update `Checker` constructor signature to accept the
   Collector. Update internal references (`this.diagnostics.push`
   etc., if any survived PR 2's codemod) to go through the
   Collector.
3. Update `checker.diagnostics()` snapshot accessor to delegate
   to `collector.snapshot()`.
4. Locate the CLI driver (`src/cli.ts` / `src/cli/driver.ts` —
   inspect the tree). Construct the Collector via
   `createDiagnostics({})`, pass into `Checker`, render via the
   formatter.
5. Update any test helper or fixture that constructs `Checker`.
   Prefer a single `tests/helpers/checker.ts` if one exists.
6. Add `tests/diagnostics/collector-isolation.test.ts` per the
   spec above.
7. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

If either fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style:

```
refactor(diagnostics): thread `Collector` through `Checker`
refactor(cli): construct `Collector` and pass into `Checker`
test(diagnostics): cover Collector isolation through `Checker`
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 3 of 6)
  for the Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- `Checker` now holds a `Collector` reference instead of a
  diagnostic list; constructor takes it as an argument
- CLI driver constructs the `Collector` and passes it in, per
  design doc §5 ("constructed and threaded (b)" — explicitly
  not a singleton)
- Plumbing-only change; checker call sites unchanged from PR 2
- Unblocks PRs 4a–4g (catalog specificity, parallelizable)

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/collector-isolation.test.ts` covers
      two Checkers with two Collectors and asserts no cross-talk
- [ ] Test helpers that construct `Checker` updated mechanically
```

Diff size note: small, targeted plumbing change. ~100–200 lines
including test-helper updates.

## Escape hatches

Stop and report if:

1. `Checker`'s current shape doesn't have a single
   `diagnostics`/`errors` field — e.g. it routes through a base
   class, mixin, or scattered properties. The design doc assumes
   a clean replacement; if that assumption is wrong, it's a
   design-doc problem.
2. The CLI driver's diagnostic-rendering path is entangled with
   non-Checker emission (e.g. parser errors flow through a
   different list). Design doc §9 PR 3 only scopes the Checker
   wiring; if other emitters need threading too, that's a
   design-doc revision, not a brief expansion.
3. Test-helper churn balloons past ~30 sites (suggests test
   construction is fragmented enough to warrant a helper PR
   first).
4. The diff exceeds ~300 lines (suggests scope creep — pause).

Report format per `_brief-template.md`.
