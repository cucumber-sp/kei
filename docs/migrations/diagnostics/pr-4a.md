# Brief: Diagnostics PR 4a — Type errors specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4a of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — full design; especially
   §3 (the discriminated-union shape), §4 (typed methods), §6
   (severity in catalog), §9 PR 4..N (this PR is the type-errors
   slice), §11 (code numbering — open question)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph;
   confirm 4a, 4b, 4c, 4d, 4e, 4f, 4g are independent siblings
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   what's already on `main` when this PR starts
5. `CONTEXT.md` — domain glossary; "Catalog", "Collector",
   "Formatter" have specific meanings
6. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4a — type
errors slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **type-errors** category out of the `untriaged`
catch-all (added in PR 2) into specific kind variants with assigned
codes. The other six categories (4b–4g) are sibling PRs and stay
on `untriaged` until their own PR lands.

**Variants this PR adds** (from design doc §9 examples; confirm
against current call sites before naming):

- `typeMismatch` — `expected T, got U` at assignment / return / arg
- `expectedType` — context-driven type expectation that no value can
  satisfy (e.g. condition must be `bool`)
- `cannotCast` — explicit cast between incompatible types
- `incompatibleAssignment` — assignment-target / RHS shape mismatch
  beyond plain type identity (e.g. `*T` vs owned)
- `nonOptionalAccess` — `.unwrap` / similar on a non-`Optional<T>`
- `unknownType` — type name resolution failure inside a type
  position (separate from `undeclaredName` which is 4b — value
  identifiers)

**Code range for this PR:** `E1xxx` (type errors). Pin specific
codes in `src/diagnostics/types.ts` as a comment block and on each
variant. Document the categorical-range convention briefly there
per design doc §11.

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants above to
  the discriminated union; envelope fields per design doc §3 (β
  decision).
- `compiler/src/diagnostics/index.ts` — add typed-method factory
  entries (`diag.typeMismatch({...})`, etc.) per design doc §4.
- `compiler/src/diagnostics/format.ts` — add a case per variant in
  the formatter `switch (diag.kind)`. TS exhaustiveness will fail
  the build until each case is present.
- `compiler/src/checker/expr-checker.ts` — migrate the type-error
  call sites that today pass through `checker.error(...)` /
  `diag.untriaged({...})`. Most variants live here.
- `compiler/src/checker/decl-checker.ts` — migrate the
  return-type-mismatch and assignment-incompatible sites.
- `compiler/src/checker/literal-checker.ts` — migrate the
  literal-doesn't-fit-target-type sites that belong to type errors
  (not name resolution).
- `compiler/tests/diagnostics/type-errors.test.ts` — NEW. One
  snapshot test per variant per design doc §12.

**Out of scope (do not touch in this PR):**

- Name-resolution variants (`undeclaredName`, `duplicateDecl`, …) —
  PR 4b's territory.
- Call-site arity / argument-type variants — PR 4c's territory
  (even though `argumentTypeMismatch` *feels* like a type error,
  it lives in `call-checker.ts` and pairs with `arityMismatch`).
- Field-access errors — PR 4d (structs).
- Lifecycle-signature errors — PR 4e.
- Operator overload errors — PR 4f.
- Module-import errors — PR 4g.
- Don't change message wording semantically beyond consolidating
  exact duplicates. Two sites that today emit the same
  `expected '${a}', got '${b}'` collapse to one variant — that's
  the win. Don't rephrase to "your type was wrong" or similar.

## Behaviour preservation

The full test suite (`bun test`) **must pass after this PR** with
existing test changes limited to *substring updates* where a
specific variant introduces a new code prefix (e.g.
`error[E1042]: expected 'int', got 'string'`) per design doc §12's
final bullet. Any test failure beyond a substring-prefix update is
a regression — investigate, don't re-snapshot.

**New tests this PR adds** (per design doc §12):

- `tests/diagnostics/type-errors.test.ts` — one snapshot per
  variant: `typeMismatch`, `expectedType`, `cannotCast`,
  `incompatibleAssignment`, `nonOptionalAccess`, `unknownType`.
  Each test constructs a minimal kei source that fires exactly one
  variant and asserts on the rendered text output.

## Forbidden shortcuts

- **Don't migrate variants outside type errors.** If you find a
  `checker.error("undeclared variable …")` site, leave it on
  `untriaged` — it's PR 4b's. Sibling-PR isolation is what makes
  4a–4g parallelizable.
- **Don't widen scope.** No new envelope fields, no new severity
  paths, no formatter rewrite.
- **Don't rephrase messages.** Consolidating two sites that emit
  identical text is in scope; rewriting "expected `int`, got
  `string`" into "type mismatch: int vs string" is not.
- **Don't add per-call severity.** Severity comes from the
  catalog default per design doc §6.
- **Don't introduce a backwards-compat shim** for the old
  `checker.error(msg, span)` helper — call sites migrate to
  `diag.<kind>({...})` directly. Sites that still need
  `untriaged` keep using it.
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11 carefully. Confirm the
   union-as-source-of-truth shape and the catalog-default severity
   path haven't drifted from what PR 1 set up.
2. List the type-error call sites today. `grep -nE
   "checker\.error\(" src/checker/expr-checker.ts
   src/checker/decl-checker.ts src/checker/literal-checker.ts` and
   classify each line into one of the six variants above (or "not
   type errors — leave alone"). If a site doesn't fit any of the
   six, either expand the variant list (with justification) or
   leave it on `untriaged` for a later PR.
3. Add the variants to `src/diagnostics/types.ts` in the `E1xxx`
   range. Pick concrete codes; document the categorical-range
   convention (§11) in a comment.
4. Add typed methods to `src/diagnostics/index.ts` for each
   variant, mirroring the `untriaged` pattern from PR 2.
5. Add a `case` per variant to `src/diagnostics/format.ts`. Match
   the wording the codemod-replaced sites used today; the
   formatter is the single owner now.
6. Migrate each identified call site from `diag.untriaged({...})`
   (or `checker.error(...)`) to the typed method. Run `bun test`
   incrementally — failures localised to one variant at a time
   are easier to triage.
7. Add `tests/diagnostics/type-errors.test.ts` with one snapshot
   per variant per design doc §12.
8. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass; substring updates allowed only for code-prefix
bunx biome check src/ tests/      # must report no issues
```

Sanity check: `grep -n "diag\.untriaged" src/checker/expr-checker.ts
src/checker/decl-checker.ts src/checker/literal-checker.ts | wc -l`
should drop by the number of sites you migrated. Don't migrate to
zero — sibling categories still need `untriaged`.

## Output

**Commit messages.** Match existing style:

```
feat(diagnostics): add type-error variants (E1xxx) and typed methods
refactor(checker): migrate type-error call sites off untriaged
test(diagnostics): snapshot one fixture per type-error variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4a) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds type-error variants `typeMismatch`, `expectedType`,
  `cannotCast`, `incompatibleAssignment`, `nonOptionalAccess`,
  `unknownType` with `E1xxx` codes
- Migrates type-error call sites in `expr-checker.ts`,
  `decl-checker.ts`, `literal-checker.ts` off `untriaged`
- Sibling categories (4b–4g) still on `untriaged`; PR 5 removes
  the catch-all once all 4x PRs land

## Test plan
- [ ] `bun test` passes (substring updates only for new code prefix)
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/type-errors.test.ts` covers all six variants
```

## Escape hatches

Stop and report if:

1. A call site you'd classify as a type error doesn't fit any of
   the six variants and you can't justify a seventh without
   widening scope (suggests the design-doc list is incomplete —
   that's a doc problem, not an implementation problem).
2. Migrating a site changes user-visible wording beyond the code
   prefix (suggests the consolidation isn't behaviour-preserving —
   stop, don't try to "fix" the wording while you're there).
3. A variant TS exhaustiveness check forces edits into another
   category's territory (suggests the union shape is wrong —
   report).
4. The diff exceeds ~600 lines added (suggests scope creep — pause).

Report format per `_brief-template.md`.
