# Brief: Diagnostics PR 4f — Operators specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4f of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity), §9 PR 4..N (this PR
   is the operators slice), §11 (codes)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state
5. `CONTEXT.md` — domain glossary
6. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4f —
operators slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **operators** category out of `untriaged` into
specific kind variants with assigned codes.

**Variants this PR adds** (from design doc §9; confirm against
current `operator-checker.ts` sites):

- `noOperatorOverload` — operator applied to operand types for
  which no overload (built-in or user-defined) exists
- `invalidOperand` — single-operand operator (unary, deref) on a
  value of a type the operator can't accept (e.g. `!` on `i32`)
- `binaryTypeMismatch` — both operands of a binary operator are
  acceptable types in isolation but don't pair (e.g. `i32 + str`)
- `unaryTypeMismatch` — narrower variant of `invalidOperand` where
  the unary operator has a known type rule and the operand misses
  it (e.g. `-` on a non-numeric)

**Code range for this PR:** `E6xxx` (operators).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants with
  `E6xxx` codes and envelope fields per §3. Each variant carries
  the operator string in its payload (e.g. `op: '+'`).
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per variant.
- `compiler/src/checker/operator-checker.ts` — primary file (~29
  `checker.error(...)` sites today). Migrate all operator-related
  sites.
- `compiler/tests/diagnostics/operators.test.ts` — NEW. One
  snapshot per variant.

**Out of scope (do not touch in this PR):**

- Plain `typeMismatch` (assignment / return) — that's 4a's. The
  split: *operator-context* type mismatches are 4f; *non-operator*
  are 4a.
- `argumentTypeMismatch` (call sites) — 4c.
- Operator dispatch resolution that fails because the *type
  itself* doesn't exist (`unknownType`) — that's 4a; the operator
  checker just plumbs that through.
- Don't change message wording semantically.

## Behaviour preservation

`bun test` must pass with only substring updates where new code
prefixes appear.

**New tests** (per design doc §12):

- `tests/diagnostics/operators.test.ts` — one snapshot per variant:
  `noOperatorOverload`, `invalidOperand`, `binaryTypeMismatch`,
  `unaryTypeMismatch`. Each test fires exactly one variant from a
  minimal kei source.

## Forbidden shortcuts

- **Don't migrate non-operator type errors.** Stay inside
  `operator-checker.ts`'s scope.
- **Don't collapse `unaryTypeMismatch` and `binaryTypeMismatch`
  into one variant.** The arity is part of the diagnostic's
  identity — formatter wording differs.
- **Don't add operator-overload-resolution behaviour.** This PR
  surfaces existing checker decisions through more specific
  diagnostics; it doesn't expand what kei can or can't do with
  operators.
- **Don't widen scope.** No `operator-checker.ts` refactor.
- **Don't rephrase messages.** Consolidate identical text only.
- **Don't add per-call severity.**
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11.
2. Enumerate operator-error sites:
   `grep -nE "checker\.error\(" src/checker/operator-checker.ts`
   should show ~29 lines. Classify each into one of the four
   variants. The `unknown binary operator '${op}'` site at
   line ~179 is borderline — treat it as `noOperatorOverload`
   (the operator has no overload because it doesn't exist as
   a kei operator at all).
3. Add variants to `src/diagnostics/types.ts` with `E6xxx` codes.
4. Add typed methods.
5. Add formatter cases. Each case includes the operator string
   in the rendered output.
6. Migrate the ~29 sites. Run `bun test` after each variant's
   migration.
7. Add `tests/diagnostics/operators.test.ts`.
8. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/checker/operator-checker.ts
| wc -l` should drop to ~0 — `operator-checker.ts` is the most
self-contained category, so PR 4f effectively empties its
`untriaged` usage.

## Output

**Commit messages.**

```
feat(diagnostics): add operator variants (E6xxx) and typed methods
refactor(checker): migrate operator-checker call sites off untriaged
test(diagnostics): snapshot one fixture per operator variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4f) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds operator variants `noOperatorOverload`, `invalidOperand`,
  `binaryTypeMismatch`, `unaryTypeMismatch` with `E6xxx` codes
- Migrates `operator-checker.ts` (~29 sites) off `untriaged`
- Sibling categories still on `untriaged`

## Test plan
- [ ] `bun test` passes
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/operators.test.ts` covers all four
      variants
```

## Escape hatches

Stop and report if:

1. A site in `operator-checker.ts` clearly belongs to a sibling
   category (e.g. a `typeMismatch` shape that 4a should own).
   Leave on `untriaged` and document; don't attempt cross-category
   migration.
2. Distinguishing `noOperatorOverload` from `binaryTypeMismatch`
   in the formatter requires the checker to plumb whether overload
   resolution was attempted at all (suggests a checker-side data
   change — escalate, don't widen).
3. The variants don't cleanly cover all ~29 sites (suggests the
   design-doc list is incomplete — report).
4. Diff exceeds ~500 lines added.

Report format per `_brief-template.md`.
