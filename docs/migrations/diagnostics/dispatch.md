# Diagnostics migration — dispatch graph

PR dependency graph and parallel dispatch strategy for the
**Diagnostics module** migration
([ADR-0001](../../adr/0001-concept-cohesive-modules.md),
[design doc](../../design/diagnostics-module.md)). This file is
a *per-migration* dispatch artifact, complementary to the
[wave table](../README.md#cadence) in `docs/migrations/README.md`.

## Dependency graph

```
PR 1 (skeleton)
  └─→ PR 2 (untriaged + codemod, 162 sites)
       └─→ PR 3 (Collector wired through Checker)
            ├─→ PR 4a (Type errors,         E1xxx)
            ├─→ PR 4b (Name resolution,     E2xxx)
            ├─→ PR 4c (Calls,               E3xxx)
            ├─→ PR 4d (Structs,             E4xxx)
            ├─→ PR 4e (Lifecycle/checker,   E5xxx)
            ├─→ PR 4f (Operators,           E6xxx)
            └─→ PR 4g (Modules,             E7xxx)
                 └─→ PR 5 (remove untriaged + delete old)
```

PRs 4a–4g are independent siblings — they can land in any order
after PR 3. PRs 1, 2, 3, 5 are sequential.

## Parallelism

PRs 4a–4g are highly parallelizable. Up to **7 simultaneous
Claude Code sessions** in worktrees, each picking one category.
Spawn pattern follows the [README's worktree dispatch](../README.md#workspace-dispatch):

```bash
git worktree add ../kei-diagnostics-pr4a -b diagnostics/pr-4a
git worktree add ../kei-diagnostics-pr4b -b diagnostics/pr-4b
# … one per category
```

Each session is fed its `pr-4*.md` brief and runs independently.
Conflicts at merge time are limited to the union in
`src/diagnostics/types.ts`, the typed-methods factory in
`src/diagnostics/index.ts`, and the formatter `switch` in
`src/diagnostics/format.ts` — three files, additive edits, low
conflict rate. The orchestrator (you) merges them in arrival
order; rebase conflicts are mechanical.

PR 5 gates on **all** of 4a–4g; running it earlier leaves the
union with `untriaged` references in the formatter `switch` that
will TS-fail.

## Code numbering

Design doc §11 leaves the numbering scheme open. **Recommended
convention:** assign categorical ranges as PRs land —

| PR  | Category               | Range  |
|-----|------------------------|--------|
| 4a  | Type errors            | E1xxx  |
| 4b  | Name resolution        | E2xxx  |
| 4c  | Calls                  | E3xxx  |
| 4d  | Structs                | E4xxx  |
| 4e  | Lifecycle / checker    | E5xxx  |
| 4f  | Operators              | E6xxx  |
| 4g  | Modules                | E7xxx  |

Within a range, codes are assigned per variant in declaration
order (`E1001`, `E1002`, …). Whichever 4x PR lands first owns the
range-convention comment in `src/diagnostics/types.ts`. Codes are
**advisory** per design doc §10.6 — no SemVer commitment pre-1.0,
but stable enough across a release that searchability works.

The other obvious option is sequential `E0001+` (Rust-style); the
categorical scheme wins because cross-category PRs land in
parallel — sequential numbering would force ordering between 4a–4g
that doesn't otherwise exist.

## Cadence recommendation

Map onto the [README wave table](../README.md#cadence):

- **Wave 1:** PR 1 (parallel with `lifecycle/pr-1`,
  `monomorphization/pr-1`)
- **Wave 2:** PR 2 (codemod) **then** PR 3 (collector threading)
  — sequential within Diagnostics; doesn't block other
  migrations.
- **Wave 3+:** PRs 4a–4g — parallelizable across categories;
  drops into Wave 3 alongside Lifecycle / Monomorph specificity
  work.
- **Wave 5:** PR 5 (remove untriaged), parallel with
  `lifecycle/pr-5` and `monomorph/pr-5` cleanup PRs.

**Realistic budget:**

- 7 sessions if 4a–4g run in parallel (Wave 3 is one wide spread)
- 12 sessions sequential (one PR per session, no parallelism)

The bottleneck is review throughput (one orchestrator) per
[README §Bottleneck](../README.md#bottleneck) — wide parallelism
front-loads the implementation work but the merge queue still
serialises through one reviewer. In practice expect 3–5 review
sessions to drain 4a–4g.

## Cross-migration interactions

- **PR 4e ↔ Lifecycle module migration.** PR 4e covers
  *user-authored* `__destroy` / `__oncopy` hook signature errors
  (Diagnostics territory). The *auto-generation* logic for those
  hooks is the Lifecycle module's territory — separate concern
  despite the name overlap. The 4e brief calls this out explicitly
  so a session running 4e doesn't reach into Lifecycle code. If a
  diagnostic site is ambiguous (fires from both paths), the 4e
  brief's escape hatch #1 says: stop and report.

- **PR 4 ↔ Monomorphization module migration.** Per
  `docs/design/monomorphization-module.md` §6's Diagnostics
  integration, baked-product body-check errors use the β envelope's
  `secondarySpans` to point at both the generic template and the
  instantiation site. PR 4e's variants might intersect with
  monomorphization-related errors but the interaction is
  *shape-of-Diagnostic*, not a hard ordering constraint. The
  monomorphization migration consumes the Diagnostics module
  through its public interface; no extra coordination required.

- **PR 4b ↔ PR 4g.** Symbol-level vs module-level import errors —
  the briefs document the split (4b = checker-pass, 4g =
  resolver-pass). If concrete sites collapse the distinction, 4g's
  escape hatch #1 says: propose merging into 4b's variant.

## Verification (post-PR 5)

After PR 5 merges, the migration is complete. Verify:

1. `bun test` passes from a clean `compiler/` checkout.
2. `grep -rn "new Diagnostic\(" compiler/src/` matches nothing
   (the old constructor-shaped API is gone).
3. `grep -rn "kind: ['\"]untriaged['\"]" compiler/src/` matches
   nothing.
4. `compiler/src/errors/diagnostic.ts` does not exist.
5. `compiler/CLAUDE.md`'s "Where to add a feature" table points
   at `src/diagnostics/` for diagnostic work.

If any check fails, the migration isn't truly done — PR 5 should
have caught it but a residual call site can slip through. File a
follow-up issue per repo policy.
