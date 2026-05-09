# Brief: Diagnostics PR 4c — Calls specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4c of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity), §9 PR 4..N (this PR
   is the calls slice), §11 (codes)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state
5. `CONTEXT.md` — domain glossary
6. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4c —
calls slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **calls** category out of `untriaged` into
specific kind variants with assigned codes.

**Variants this PR adds** (from design doc §9; confirm against
current call sites):

- `arityMismatch` — fn called with wrong number of arguments
- `argumentTypeMismatch` — argument N's type doesn't satisfy the
  parameter type. Carries the parameter index in the payload so
  the formatter can render `argument 2:` with a secondary span at
  the parameter's declaration site.
- `notCallable` — call expression on a non-callable value
- `genericArgMismatch` — explicit type-argument count or kind
  doesn't match the generic's parameters (e.g. `foo<i32, str>(x)`
  where `foo` is `<T>`)
- `methodNotFound` — method-call dispatch can't find a method of
  that name on the receiver type

**Code range for this PR:** `E3xxx` (calls).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants with
  `E3xxx` codes and envelope fields per design doc §3.
  `argumentTypeMismatch` carries `paramIndex: number`.
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per
  variant. `argumentTypeMismatch` renders the parameter index
  ("in argument 2:") and uses `secondarySpans` to point at the
  declaration site of the offending parameter.
- `compiler/src/checker/call-checker.ts` — primary file, ~35
  `checker.error(...)` sites today; migrate the calls-related
  ones to the typed methods.
- `compiler/src/checker/expr-checker.ts` — method-call dispatch
  paths that emit `methodNotFound`-class errors live here.
- `compiler/tests/diagnostics/calls.test.ts` — NEW. One snapshot
  per variant.

**Out of scope (do not touch in this PR):**

- Plain `typeMismatch` (assignment / return) — that's 4a's even
  if `argumentTypeMismatch` is conceptually similar. The split:
  *call-site* type mismatch is `argumentTypeMismatch` (4c);
  *non-call-site* is `typeMismatch` (4a).
- Operator overload resolution — 4f.
- `undeclaredName` for identifiers in callee position — that's 4b.
  This PR assumes the callee resolved; calls-category errors
  surface *after* the callee is bound.
- Don't change message wording semantically.

## Behaviour preservation

`bun test` must pass with only substring updates where new code
prefixes appear.

**New tests** (per design doc §12):

- `tests/diagnostics/calls.test.ts` — one snapshot per variant:
  `arityMismatch`, `argumentTypeMismatch`, `notCallable`,
  `genericArgMismatch`, `methodNotFound`. The
  `argumentTypeMismatch` snapshot must verify the secondary span
  points at the parameter's declaration site, not just the
  argument expression.

## Forbidden shortcuts

- **Don't migrate sibling-category variants.** If `call-checker.ts`
  emits a name-resolution error (e.g. callee not found), leave it
  on `untriaged` — PR 4b's territory.
- **Don't collapse `argumentTypeMismatch` into `typeMismatch`.**
  The design doc lists them separately because the call-site
  context (parameter index, declaration secondary span) is part
  of the diagnostic's identity. Merging loses that.
- **Don't widen scope.** No new envelope shape, no formatter
  rewrite, no checker refactor.
- **Don't rephrase messages.** Consolidate identical text only.
- **Don't add per-call severity.**
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11.
2. Enumerate call-site error patterns in `call-checker.ts` (~35
   sites). Classify each into one of the five variants. Method
   dispatch in `expr-checker.ts` adds the `methodNotFound` source.
3. Add variants to `src/diagnostics/types.ts` with `E3xxx` codes.
   Pay attention to `argumentTypeMismatch.paramIndex` — it's the
   non-trivial payload field.
4. Add typed methods to `src/diagnostics/index.ts`.
5. Add formatter cases. The `argumentTypeMismatch` case should
   produce output like:

   ```
   error[E3002]: argument 2 type mismatch
     --> foo.kei:5:14
   5 | greet("hello", 42)
     |                ^^ expected 'bool', got 'i32'
   note: parameter declared here
     --> foo.kei:1:23
   1 | fn greet(s: str, b: bool): void
     |                  ^
   ```

   Use `secondarySpans` for the declaration pointer per design doc §3.
6. Migrate call sites. Run `bun test` after each variant's
   migration; one variant at a time keeps the diff legible.
7. Add `tests/diagnostics/calls.test.ts`.
8. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/checker/call-checker.ts
src/checker/expr-checker.ts | wc -l` should drop by the number of
calls-category sites migrated.

## Output

**Commit messages.**

```
feat(diagnostics): add call variants (E3xxx) and typed methods
refactor(checker): migrate call-site error reporting off untriaged
test(diagnostics): snapshot one fixture per call variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4c) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds call variants `arityMismatch`, `argumentTypeMismatch`,
  `notCallable`, `genericArgMismatch`, `methodNotFound` with
  `E3xxx` codes
- `argumentTypeMismatch` carries `paramIndex` and uses
  `secondarySpans` to point at the parameter declaration
- Migrates `call-checker.ts` (~35 sites) and method-dispatch sites
  in `expr-checker.ts` off `untriaged`
- Sibling categories still on `untriaged`

## Test plan
- [ ] `bun test` passes
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/calls.test.ts` covers all five variants;
      `argumentTypeMismatch` verifies the secondary-span target
```

## Escape hatches

Stop and report if:

1. A call-site error doesn't fit any of the five variants and
   doesn't belong to a sibling category (suggests the design-doc
   list is incomplete).
2. The secondary-span plumbing for `argumentTypeMismatch` requires
   threading a span the checker doesn't currently track at the
   call site (suggests an orthogonal data-flow change — escalate
   rather than widen scope).
3. `genericArgMismatch` doesn't surface in any current test
   (suggests the variant exists pre-emptively for #19's generic
   work — confirm with the orchestrator before adding).
4. Diff exceeds ~700 lines added.

Report format per `_brief-template.md`.
