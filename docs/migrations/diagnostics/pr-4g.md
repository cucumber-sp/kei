# Brief: Diagnostics PR 4g — Modules specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4g of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity), §9 PR 4..N (this PR
   is the modules slice), §11 (codes)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state
5. `CONTEXT.md` — domain glossary
6. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4g —
modules slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **modules** category out of `untriaged` into
specific kind variants with assigned codes. These are
*module-level* errors, not symbol-level — symbol-import errors
(e.g. "X is not exported by Y") were 4b's territory.

**Variants this PR adds** (from design doc §9; confirm against
current `modules/resolver.ts` and `checker.ts` adoption sites):

- `cyclicImport` — import graph contains a cycle. Carries the
  cycle as `path: string[]` so the formatter can render the chain.
- `moduleNotFound` — `import` references a path that doesn't
  resolve to a kei file
- `importedSymbolNotExported` — module-level surfacing of the
  4b-equivalent at the resolver layer (kept here when the error
  originates *during* module resolution, before the checker has
  had a chance to look at the symbol). This intentionally
  duplicates with 4b's `unresolvedImport`; the split is
  *which-pass-emits-it*. Document the duplication; pick one
  canonical kind in v1 if the call sites collapse.
- `mixedModuleStyles` — kei doesn't allow mixing module styles
  in a single import graph (today's rule the resolver enforces)

**Code range for this PR:** `E7xxx` (modules).

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the variants with
  `E7xxx` codes and envelope fields per §3. `cyclicImport`
  carries `path: string[]` (the cycle).
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per variant.
  `cyclicImport` renders the cycle as `A → B → C → A`.
- `compiler/src/modules/resolver.ts` — primary file. The resolver
  has its own diagnostic accumulation that today flows through
  the checker via the `getDiagnostics() / clearDiagnostics()` pair
  in `checker.ts`'s `resolveType` helper. Either rewrite the
  resolver to emit through the threaded `Collector` directly, or
  keep the existing accumulation and re-stamp the kind during
  the surfacing step. Either is fine; pick the simpler one.
- `compiler/src/checker/checker.ts` — the cross-module adoption
  sites (where adoption-related errors fire). Migrate those.
- `compiler/tests/diagnostics/modules.test.ts` — NEW. One snapshot
  per variant.

**Out of scope (do not touch in this PR):**

- Symbol-level import errors that the *checker* (not the resolver)
  emits — those are 4b's `unresolvedImport`. The split:
  *resolver-pass* errors are 4g; *checker-pass* errors on imported
  symbols are 4b.
- Type-resolution failures inside imported types — that's 4a.
- Don't change message wording semantically.

## Behaviour preservation

`bun test` must pass with only substring updates where new code
prefixes appear.

**New tests** (per design doc §12):

- `tests/diagnostics/modules.test.ts` — one snapshot per variant:
  `cyclicImport`, `moduleNotFound`, `importedSymbolNotExported`,
  `mixedModuleStyles`. The `cyclicImport` test must use a
  multi-file fixture so the rendered cycle is non-trivial
  (`A → B → A` minimum).

## Forbidden shortcuts

- **Don't migrate symbol-level import errors that fire in
  checker passes** — 4b's territory.
- **Don't redesign the resolver's diagnostic plumbing** beyond
  what's needed to surface specific kinds. PR 3 wired the
  collector through the checker; if the resolver still uses its
  own list, that's tolerable as long as the surfacing step emits
  the right kinds.
- **Don't widen scope.** No new module-system features.
- **Don't rephrase messages.** Consolidate identical text only.
- **Don't add per-call severity.**
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11.
2. Enumerate module-level error sources:
   - `src/modules/resolver.ts` — read the diagnostics it
     accumulates today (the `MAX_RENDERED_DIAGS` rendering path is
     a hint that there's a list).
   - `src/checker/checker.ts` — find the adoption-related error
     sites; some are currently `untriaged` post-PR-2.
3. Classify each into the four variants. If
   `importedSymbolNotExported` collapses with 4b's
   `unresolvedImport` after looking at concrete sites, prefer 4b's
   kind and drop this one — note in the PR description.
4. Add variants to `src/diagnostics/types.ts` with `E7xxx` codes.
   `cyclicImport.path: string[]`.
5. Add typed methods.
6. Add formatter cases. `cyclicImport` formats `A → B → C → A` on
   one line, with secondary spans pointing at each module's
   `import` statement (best-effort; `notes` if spans aren't
   available).
7. Migrate identified sites.
8. Add `tests/diagnostics/modules.test.ts`.
9. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/modules/resolver.ts
src/checker/checker.ts | wc -l` should drop by the number of
modules-category sites migrated.

## Output

**Commit messages.**

```
feat(diagnostics): add module variants (E7xxx) and typed methods
refactor(modules): migrate resolver / adoption sites off untriaged
test(diagnostics): snapshot one fixture per module variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4g) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds module variants `cyclicImport`, `moduleNotFound`,
  `importedSymbolNotExported`, `mixedModuleStyles` with `E7xxx`
  codes
- `cyclicImport` carries `path: string[]` and renders the cycle
- Migrates `modules/resolver.ts` and `checker.ts` adoption sites
  off `untriaged`
- This is the last sibling PR; PR 5 removes `untriaged` next

## Test plan
- [ ] `bun test` passes
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/modules.test.ts` covers all four variants;
      `cyclicImport` test uses a multi-file fixture
```

## Escape hatches

Stop and report if:

1. The 4b / 4g split on `importedSymbolNotExported` vs
   `unresolvedImport` is ambiguous for a particular site
   (suggests the boundary is fuzzy — propose collapsing in the PR
   description rather than picking sides silently).
2. The resolver's diagnostic plumbing requires a wider refactor to
   emit specific kinds (suggests PR 3's collector threading didn't
   reach the resolver — that's a PR 3 follow-up, not a 4g problem;
   escalate).
3. `mixedModuleStyles` doesn't fire anywhere in current tests
   (suggests the rule isn't actually enforced — confirm with the
   orchestrator).
4. Diff exceeds ~600 lines added.

Report format per `_brief-template.md`.
