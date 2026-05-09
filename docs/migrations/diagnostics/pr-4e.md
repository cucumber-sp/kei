# Brief: Diagnostics PR 4e — Lifecycle / checker rules specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4e of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity), §9 PR 4..N (this PR
   is the lifecycle / checker-rules slice), §11 (codes)
3. `docs/design/lifecycle-module.md` — to understand the boundary
   between this PR (diagnostics for *user-authored* hooks) and the
   Lifecycle module (auto-generated hooks). They overlap in name
   only.
4. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph;
   in particular the cross-migration interactions section
5. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state
6. `CONTEXT.md` — domain glossary; "Lifecycle" has a specific
   meaning that explicitly *excludes* user-authored hook
   signature validation
7. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4e —
lifecycle / checker-rules slice of "PR 4..N — Specificity,
parallelizable").

This PR carves the **lifecycle-hook signature and checker-rule**
category out of `untriaged` into specific kind variants with
assigned codes. The errors are about *user-authored*
`__destroy` / `__oncopy` hooks — the rules they must follow when
the user writes them on an `unsafe struct`.

**Variants this PR adds** (from design doc §9; confirm against
current `struct-checker.ts` rules):

- `invalidLifecycleSignature` — `__destroy` / `__oncopy` declared
  with the wrong shape (wrong arity, wrong parameter type, etc.)
- `unsafeStructMissingDestroy` — `unsafe struct` declares
  `__oncopy` but not `__destroy` (or other manage-pair-rule
  violations the spec requires)
- `unsafeStructMissingOncopy` — symmetric pair-rule
- `lifecycleHookSelfMismatch` — `__destroy` / `__oncopy` `self`
  parameter type doesn't match `*Self`
- `lifecycleReturnTypeWrong` — lifecycle hook return type isn't
  `void` (today's `lifecycle hook '${method.name}' must return
  void` site at `decl-checker.ts:268`)

**Code range for this PR:** `E5xxx` (lifecycle / checker rules).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants with
  `E5xxx` codes and envelope fields per §3.
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per variant.
- `compiler/src/checker/struct-checker.ts` — primary file for the
  `unsafe struct` validation rules around `__destroy` / `__oncopy`.
- `compiler/src/checker/decl-checker.ts` — for the
  `lifecycleReturnTypeWrong` site at line ~268.
- `compiler/tests/diagnostics/lifecycle-rules.test.ts` — NEW. One
  snapshot per variant.

**Out of scope (do not touch in this PR):**

- **Auto-generation of `__destroy` / `__oncopy`** — that's the
  Lifecycle module migration's territory, not this PR. The
  Lifecycle module owns the *Decide / Synthesise / Insert* triple;
  this PR owns *what the user typed in is or isn't a valid hook*.
  They share the `__destroy` / `__oncopy` keywords; they're
  separate concerns.
- **Lifecycle-decision errors** (e.g. "type X is managed but no
  destroy can be synthesised"). Those flow from the Lifecycle
  module's Decide step and emit through diagnostics from there;
  if those sites currently use `untriaged`, they get migrated by
  the Lifecycle module's own PR, not this one.
- **Field-shape rules on `unsafe struct`** — that's 4d's
  `unsafeStructFieldRule`. The split: *field declarations* are 4d;
  *user-authored hook signatures* are this PR (4e).
- Don't change message wording semantically.

## Behaviour preservation

`bun test` must pass with only substring updates where new code
prefixes appear.

**New tests** (per design doc §12):

- `tests/diagnostics/lifecycle-rules.test.ts` — one snapshot per
  variant: `invalidLifecycleSignature`, `unsafeStructMissingDestroy`,
  `unsafeStructMissingOncopy`, `lifecycleHookSelfMismatch`,
  `lifecycleReturnTypeWrong`. Each test fires exactly one variant
  from a minimal kei source containing a malformed `unsafe struct`
  with hand-authored hooks.

## Forbidden shortcuts

- **Don't migrate Lifecycle-module-owned diagnostics.** If the
  error originates from auto-generation logic, the Lifecycle
  migration's PRs handle it. This PR is strictly about validating
  what the user wrote.
- **Don't migrate field-shape errors** — those are 4d's.
- **Don't widen scope.** No refactor of `struct-checker.ts`'s
  validation pass.
- **Don't rephrase messages.** Consolidate identical text only.
- **Don't add per-call severity.**
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11. Read
   `docs/design/lifecycle-module.md` for the boundary clarification.
2. Enumerate hook-validation sites in `struct-checker.ts`
   (`grep -nE "this\.checker\.error\(" src/checker/struct-checker.ts`)
   plus the `lifecycle hook '...' must return void` site in
   `decl-checker.ts`. Classify:
   - user-authored hook signature/shape rule? → 4e (this PR)
   - field-declaration rule? → 4d (leave on `untriaged`)
   - auto-generation issue? → Lifecycle module's PR (leave alone)
3. Add variants to `src/diagnostics/types.ts` with `E5xxx` codes.
4. Add typed methods.
5. Add formatter cases. The wording for hook-signature errors
   should reference the spec section that defines the rule, in a
   `notes` envelope field where helpful.
6. Migrate identified sites.
7. Add `tests/diagnostics/lifecycle-rules.test.ts`.
8. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/checker/struct-checker.ts
src/checker/decl-checker.ts | wc -l` should drop by the number of
lifecycle-rule sites migrated; field-rule and auto-gen sites
remain.

## Output

**Commit messages.**

```
feat(diagnostics): add lifecycle-rule variants (E5xxx) and methods
refactor(checker): migrate user-hook validation off untriaged
test(diagnostics): snapshot one fixture per lifecycle-rule variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4e) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds lifecycle-rule variants `invalidLifecycleSignature`,
  `unsafeStructMissingDestroy`, `unsafeStructMissingOncopy`,
  `lifecycleHookSelfMismatch`, `lifecycleReturnTypeWrong` with
  `E5xxx` codes
- Migrates user-authored hook validation sites in
  `struct-checker.ts` and `decl-checker.ts` off `untriaged`
- Auto-generated lifecycle errors (the Lifecycle module's
  territory) are not touched here — see
  `docs/design/lifecycle-module.md` for that migration

## Test plan
- [ ] `bun test` passes
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/lifecycle-rules.test.ts` covers all five
      variants
```

## Escape hatches

Stop and report if:

1. The 4e / Lifecycle-module-migration boundary is ambiguous for
   a particular site (e.g. an error that fires *both* during
   auto-gen *and* on user-authored hooks). Escalate; don't pick
   sides on your own.
2. The `unsafeStructMissing*` pair-rule isn't actually enforced by
   current code (suggests the variant is forward-looking for a
   spec rule not yet shipped — confirm with the orchestrator).
3. Migrating `lifecycleReturnTypeWrong` requires reaching into
   the Lifecycle module's Synthesise step (suggests a leaky
   abstraction — escalate).
4. Diff exceeds ~500 lines added.

Report format per `_brief-template.md`.
