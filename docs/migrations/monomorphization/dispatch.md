# Monomorphization migration — dispatch graph

PR dependency graph and parallel-dispatch strategy for the
[Monomorphization module](../../design/monomorphization-module.md)
migration under [ADR-0001](../../adr/0001-concept-cohesive-modules.md).

The Monomorphization migration's payoff is **PR 5** — deletion
of the per-instantiation type-map override on `LoweringCtx`. PR 5
is gated on **PR 4** (Y-a baking), which is the load-bearing PR
of the migration. PR 4 transforms the data flow; PR 5 collects
the simplification.

## Dependency graph

```
PR 1 (relocate pure helpers)
  └─→ PR 2 (move maps off Checker)
       └─→ PR 3 (move pass-3 driver)
            └─→ PR 4 (bake — Y-a; the load-bearing PR)
                 └─→ PR 5 (delete override; the payoff)
                      └─→ PR 6 (cleanup, delete shim)
```

This migration is **sequential**. Unlike Lifecycle PR 4 or
Diagnostics PR 4, monomorphization PRs do not split into
parallel siblings — each strictly depends on the previous. The
reason: every PR transforms the **same** data flow (the maps,
then the products list, then the synthesised AST decls), so
concurrent edits would conflict at the data shape.

## Parallelism

**Within the migration: none.** PR N requires PR N-1 in main
before it can be authored cleanly.

**Across migrations: substantial.** While Monomorphization PRs
land sequentially, Lifecycle PRs 4a–4e and Diagnostics PRs 4a–4g
can run concurrently — they touch unrelated files. The realised
parallelism is at the wave level (see Cadence below), not within
the Monomorphization stream.

## Cross-migration interactions

- **Lifecycle integration (PR 4 hook).** Monomorphization PR 4
  calls `lifecycle.decide(bakedStruct)` per design doc §5. This
  requires Lifecycle PR 1 to have landed already so that
  `lifecycle.decide` exists as an importable symbol. The hook
  also locks in the Q5c interaction question deferred from the
  lifecycle design — once PR 4 ships, that question is closed
  by construction.

- **Diagnostics integration (PR 4 errors).** Monomorphization
  PR 4's pass-3 errors use Diagnostics' `secondarySpans`
  envelope (design doc §6, mirrored in
  `docs/design/diagnostics-module.md` §6) to point at the
  instantiation site. If Diagnostics is still threading
  `untriaged` codes when Monomorphization PR 4 lands, that's
  fine: Monomorphization's errors land as untriaged with the
  right span and message; Diagnostics PR 4e (or the appropriate
  category PR — likely the lifecycle/checker bucket, with a
  variant for "in instantiation `Foo<i32>` at <site>")
  tightens them later.

- **`#40` LoweringCtx hygiene.** Monomorphization PR 5 removes
  exactly two fields from `LoweringCtx`: `currentBodyTypeMap`
  and `currentBodyGenericResolutions`. Every other field on
  `LoweringCtx` is `#40`'s scope. The two migrations don't
  overlap and can land in either order; PR 5 should not pick up
  `#40` work, and `#40` should not assume PR 5 hasn't shipped.

## Cadence recommendation

Wave-level mapping (with `docs/migrations/README.md`'s wave
table):

- **Wave 1** — PR 1 (foundation: stand up `src/monomorphization/`).
  Parallel with Lifecycle PR 1 and Diagnostics PR 1; no overlap.
- **Wave 3** — PR 2 (move maps off Checker). Parallel with
  Lifecycle PR 2 and Diagnostics PRs 4a–g (specificity).
- **Wave 4** — PR 3 (pass-3 driver) and PR 4 (Y-a bake).
  Sequential within Monomorphization; concurrent with Lifecycle
  per-site cutovers.
- **Wave 5** — PR 5 (delete override; the payoff) and PR 6
  (cleanup). Sequential within Monomorphization; concurrent with
  Lifecycle PR 5 and Diagnostics' "remove untriaged" PR.

**Realistic budget:** 5–6 focused orchestration sessions for the
migration end-to-end. The migration cannot be parallelised
within itself; the bottleneck is sequential review pace, gated
on PR 4's correctness.

## Verification (after PR 6 merges)

After PR 6 lands, the migration is done. Verify:

1. `bun test` passes against the merged main.
2. `rg 'currentBodyTypeMap|currentBodyGenericResolutions' compiler/src/`
   matches nothing — the override stack is gone.
3. `rg 'from .*generics' compiler/src/` matches nothing — the
   re-export shim is gone.
4. `LoweringCtx` no longer has any monomorphization-specific
   fields.
5. Lowering files (`lowering-decl.ts`, `lowering-struct.ts`,
   `lowering-types.ts`, `lowering-expr.ts`) contain no
   "is this from a monomorphization?" branches — every decl is
   just-another-AST-decl.
6. `compiler/CLAUDE.md`'s "Where to add a feature" table points
   at `src/monomorphization/` for generic work.

If any of those fails, the migration is incomplete — the
relevant PR's verification recipe was not honoured.
