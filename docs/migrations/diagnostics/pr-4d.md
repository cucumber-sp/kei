# Brief: Diagnostics PR 4d — Structs specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4d of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity), §9 PR 4..N (this PR
   is the structs slice), §11 (codes)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state
5. `CONTEXT.md` — domain glossary; in particular "Managed type"
   for the `unsafe struct` field-rule context
6. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4d —
structs slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **structs** category out of `untriaged` into
specific kind variants with assigned codes.

**Variants this PR adds** (from design doc §9; confirm against
current call sites):

- `unknownField` — struct-literal or field-access references a
  field name the struct doesn't have
- `missingField` — struct-literal omits a required field
- `invalidFieldAccess` — `.field` on a non-struct value, or on a
  pointer that needs `*` first, or on a value where the field
  isn't accessible from the current scope
- `cannotConstructStruct` — struct-literal expression for a struct
  that can't be directly constructed (e.g. opaque types,
  `unsafe struct` from outside `unsafe`)
- `unsafeStructFieldRule` — `unsafe struct` field declaration
  violates a structural rule (the rule that today fires from
  `struct-checker.ts`'s `unsafe struct` validation, *not*
  including the lifecycle-hook signature checks which are 4e's)

**Code range for this PR:** `E4xxx` (structs).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants with
  `E4xxx` codes and envelope fields per §3.
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per variant.
- `compiler/src/checker/struct-checker.ts` — primary file. Migrate
  field-rule validation sites *except* the lifecycle-hook signature
  checks which belong to 4e.
- `compiler/src/checker/expr-checker.ts` — migrate field-access
  errors (the `MemberExpr` paths).
- `compiler/tests/diagnostics/structs.test.ts` — NEW. One snapshot
  per variant.

**Out of scope (do not touch in this PR):**

- Lifecycle-hook signature errors on `unsafe struct` (e.g.
  `__destroy must take 'self: *Self'`) — those are 4e's. The
  split: *field-shape rules* are 4d (this PR);
  *user-authored hook signature rules* are 4e.
- Type-resolution failures inside a field's type annotation —
  that's 4a's `unknownType`. The struct-checker just plumbs the
  type-resolver's diagnostics through; don't reclassify them.
- Auto-generated lifecycle decisions (the `Lifecycle` module's
  Decide step) — that's a separate ADR-0001 module, not this PR.
- Don't change message wording semantically.

## Behaviour preservation

`bun test` must pass with only substring updates where new code
prefixes appear.

**New tests** (per design doc §12):

- `tests/diagnostics/structs.test.ts` — one snapshot per variant:
  `unknownField`, `missingField`, `invalidFieldAccess`,
  `cannotConstructStruct`, `unsafeStructFieldRule`. Each test
  fires exactly one variant from a minimal kei source.

## Forbidden shortcuts

- **Don't migrate lifecycle-hook signature errors.** Those are
  4e's. The boundary: if the error message mentions `__destroy`,
  `__oncopy`, or "lifecycle hook", it's 4e. If it mentions a
  field name or struct-literal shape, it's 4d.
- **Don't migrate type-resolution-inside-field-type errors** —
  those flow from the type resolver and belong to 4a.
- **Don't widen scope.** Specifically: don't refactor
  `struct-checker.ts`'s pass structure while migrating its
  diagnostics.
- **Don't rephrase messages.** Consolidate identical text only.
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11.
2. Enumerate struct-error sites in `struct-checker.ts` (~11 sites
   per `grep -nE "this\.checker\.error\(" src/checker/struct-checker.ts`)
   and field-access sites in `expr-checker.ts`. Classify each:
   - field-shape rule? → 4d (this PR)
   - lifecycle hook? → 4e (leave on `untriaged`)
   - type inside field annotation? → 4a (leave on `untriaged`)
3. Add variants to `src/diagnostics/types.ts` with `E4xxx` codes.
   `missingField` carries the field name in the payload;
   `unknownField` similarly.
4. Add typed methods.
5. Add formatter cases.
6. Migrate identified sites.
7. Add `tests/diagnostics/structs.test.ts`.
8. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/checker/struct-checker.ts
src/checker/expr-checker.ts | wc -l` should drop by the number of
struct-category sites migrated. Lifecycle-hook sites remain.

## Output

**Commit messages.**

```
feat(diagnostics): add struct variants (E4xxx) and typed methods
refactor(checker): migrate struct field-rule call sites off untriaged
test(diagnostics): snapshot one fixture per struct variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4d) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds struct variants `unknownField`, `missingField`,
  `invalidFieldAccess`, `cannotConstructStruct`,
  `unsafeStructFieldRule` with `E4xxx` codes
- Migrates field-shape rule sites in `struct-checker.ts` and
  field-access sites in `expr-checker.ts` off `untriaged`
- Lifecycle-hook signature errors stay on `untriaged` — PR 4e's
  scope

## Test plan
- [ ] `bun test` passes
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/structs.test.ts` covers all five variants
```

## Escape hatches

Stop and report if:

1. The 4d / 4e split (field-shape rules vs lifecycle-hook
   signatures) on `unsafe struct` is ambiguous for a particular
   site (suggests the boundary is fuzzy — escalate).
2. `cannotConstructStruct` doesn't surface in any current test
   (suggests the variant is pre-emptive for a feature not yet
   shipped — confirm with the orchestrator).
3. Migrating `invalidFieldAccess` requires the formatter to
   distinguish between several sub-cases (non-struct, needs deref,
   inaccessible) and the design doc doesn't separate them. Either
   the variant carries a sub-discriminator field, or it splits
   into multiple variants — that's a design-doc question, report.
4. Diff exceeds ~500 lines added.

Report format per `_brief-template.md`.
