# Brief: Diagnostics PR 1 — Stand up `src/diagnostics/`

## Context (read first)

You are a fresh Claude Code session implementing PR 1 of the
**Diagnostics module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — full design; especially
   §1 (why), §3 (the discriminated-union shape), §4 (typed
   methods), §5 (collector — constructed and threaded), §9 PR 1
   (this PR)
3. `CONTEXT.md` — domain glossary; "Diagnostics", "Catalog",
   "Collector", "Formatter" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 1).

This PR stands up the new `src/diagnostics/` module skeleton —
types, collector, text formatter — with **no call-site changes**.
The old `src/errors/diagnostic.ts` is untouched. Behaviour
identical; the test suite must pass without changes other than
the new tests for the new module.

**Files affected:**

- **NEW** `compiler/src/diagnostics/types.ts` — the `Diagnostic`
  discriminated-union type (initially with **zero** kind variants
  — the union starts empty and gets populated by PR 2's
  `untriaged` catch-all and PR 4+'s specific variants). Plus the
  envelope types (`Severity`, `secondarySpans`, etc.) per design
  doc §3.
- **NEW** `compiler/src/diagnostics/collector.ts` — the `Collector`
  interface plus a default `createCollector(config: LintConfig =
  {})` implementation. `LintConfig` is `{}` in v1 — leave the
  hook in place per design doc §6.
- **NEW** `compiler/src/diagnostics/format.ts` — the text
  formatter. Walks the union exhaustively. Until PR 2 adds the
  `untriaged` variant, the formatter is essentially a stub —
  TS exhaustiveness check is satisfied because the union is empty.
- **NEW** `compiler/src/diagnostics/index.ts` — public interface:
  `createDiagnostics(config?)`, returning the typed-methods object
  per design doc §4. With zero variants, the methods object has
  only a `diagnostics()` accessor for now.

**Out of scope (do not touch in this PR):**

- Don't modify `src/errors/diagnostic.ts` — leaves PR 2's codemod
  with a clean before-state.
- Don't touch any checker, parser, or KIR file — no call-site
  migration in this PR.
- Don't add any kind variants — PR 2 adds the `untriaged`
  catch-all, PR 4+ adds the specific ones.
- Don't add JSON formatter — it's a separate concern; the design
  doc lists it as a follow-up after PR 1.

## Behaviour preservation

Every test in `compiler/tests/` must pass. This PR adds files
without affecting any existing call site, so regressions
indicate something wrong with the file additions (e.g.
accidental side-effect imports).

**New tests added by this PR** (per design doc §12):

- `compiler/tests/diagnostics/collector.test.ts` — unit tests
  for the `Collector`:
  - empty collector returns empty `diagnostics()`
  - emit + snapshot roundtrip preserves order
  - severity resolution: with empty `LintConfig`, returns the
    catalog default unchanged (use a synthetic test variant via
    the type system; no real variant exists yet)
  - constructed collectors are isolated (two collectors, emit
    into one, the other stays empty)
- `compiler/tests/diagnostics/format.test.ts` — empty-union case
  produces a sensible message for "no diagnostics"; reserve more
  cases for PR 4+.

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.** `package.json` must not
  change.
- **Don't add a kind variant.** Even a single test variant
  bleeds into the public union. Use a TS-level helper variant
  inside `tests/` if you need one for collector tests; don't
  export it from `src/diagnostics/types.ts`.
- **Don't add an "any-severity" backdoor.** Severity resolution
  goes through the catalog default + lint config path. No
  per-call severity parameter — design doc §6 forbids it.
- **Don't widen scope.** If you spot related friction (e.g.
  `errors/diagnostic.ts` looks tangled), note it for PR 2 and
  move on.

## Implementation steps

1. Read design doc §3 carefully — the `Diagnostic` type shape
   matters; envelope vs per-variant fields (β decision) is
   load-bearing.
2. Create `src/diagnostics/types.ts` with `Severity`, `Span`
   (re-export from existing `errors/diagnostic.ts`'s
   `SourceLocation` for now — don't redefine), envelope
   shape, and the empty discriminated union.
3. Create `src/diagnostics/collector.ts` with a `Collector`
   interface and `createCollector(config)`. Internally:
   `Diagnostic[]` array, `emit()` resolves severity via a
   helper, `snapshot()` returns a frozen copy.
4. Create `src/diagnostics/format.ts` with the text formatter
   skeleton. Use a `switch (diag.kind)` with TS exhaustiveness
   — currently covers nothing because the union is empty, but
   sets up the pattern for PR 4+.
5. Create `src/diagnostics/index.ts` re-exporting and binding
   the typed-methods factory.
6. Add tests per the list above. Use `bun:test`; conventions
   match existing `tests/checker/*.test.ts`.
7. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

If either fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
feat(diagnostics): introduce src/diagnostics module skeleton
test(diagnostics): cover collector emit/snapshot/severity-resolution
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 1 of 6)
  for the Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds module skeleton: types (empty union), `Collector`
  (constructed-and-threaded), text formatter
- No call-site changes; old `src/errors/diagnostic.ts` untouched
- PR 2 adds the `untriaged` catch-all + codemod for the 162
  existing call sites

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/diagnostics/collector.test.ts` covers
      construction isolation, emit/snapshot, severity resolution
```

## Escape hatches

Stop and report if:

1. The empty-union starting point causes TS to reject the
   formatter's exhaustive `switch` (suggests a TS config issue
   the design doc didn't anticipate).
2. `Span` / `SourceLocation` re-export turns out to introduce a
   circular import — design doc didn't predict this; report
   instead of fudging.
3. The diff exceeds ~400 lines added (suggests scope creep).

Report format per `_brief-template.md`.
