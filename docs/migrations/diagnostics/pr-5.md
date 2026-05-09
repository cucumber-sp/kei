# Brief: Diagnostics PR 5 — Remove `untriaged` and delete old type

## Context (read first)

You are a fresh Claude Code session implementing PR 5 of the
**Diagnostics module** migration — the cleanup PR. You have no
prior context from the architecture-review session that produced
this work. Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §9 PR N+1
   (this PR, numbered `pr-5.md` here for filename consistency)
3. `docs/migrations/diagnostics/dispatch.md` — confirm all of
   4a–4g have merged; this PR gates on them
4. `docs/migrations/diagnostics/pr-4a.md` … `pr-4g.md` — the
   sibling specificity PRs whose work this one cleans up after
5. `CONTEXT.md` — domain glossary
6. `compiler/CLAUDE.md` — build / test / lint, plus the "Where to
   add a feature" table this PR updates

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR N+1 —
"Remove untriaged + delete `src/errors/diagnostic.ts`"; numbered
`pr-5.md` in this directory for filename consistency with the
sibling specificity PRs).

After 4a–4g have all merged, no call site should still be using
`diag.untriaged({...})`. This PR verifies that, removes the
`untriaged` arm from the discriminated union, removes the
formatter case, and deletes the legacy `src/errors/diagnostic.ts`
plus the alias re-export PR 2 left in place.

**Files affected:**

- `compiler/src/diagnostics/types.ts` — remove the `untriaged`
  variant from the `Diagnostic` union.
- `compiler/src/diagnostics/format.ts` — remove the `untriaged`
  formatter case. TS exhaustiveness now confirms the union has
  no missing arms.
- `compiler/src/diagnostics/index.ts` — remove the
  `diag.untriaged({...})` typed method.
- **DELETED** `compiler/src/errors/diagnostic.ts` — the legacy
  type. Any remaining re-export shim PR 2 left in place dies
  with it.
- `compiler/src/errors/index.ts` — remove the re-export of the
  deleted file (or delete `compiler/src/errors/` entirely if
  this was its only contents — confirm before removing the
  directory).
- `compiler/CLAUDE.md` — update the "Where to add a feature"
  table to reflect that diagnostics live at `src/diagnostics/`,
  not `src/errors/`. The table currently doesn't have a
  diagnostics row; add one if missing or update the relevant
  cell if present.
- `compiler/tests/diagnostics/*` — drop any `untriaged` snapshot
  fixtures left behind from PR 2.

**Out of scope (do not touch in this PR):**

- **Don't run this PR before all of 4a–4g have merged.** The
  `untriaged` removal is a hard gate. If `grep -rn "diag\.untriaged"
  src/` returns any hit, stop and report which sibling PR is
  incomplete.
- **Don't keep a "deprecated" alias** of the old `Diagnostic`
  interface "just in case". Design doc §9 calls for the
  deletion. Consumers outside `compiler/src/` (if any — there
  shouldn't be any) get migrated, not aliased.
- **Don't widen scope.** No new variants, no formatter rewrites,
  no new categories.
- Don't change message wording.

## Behaviour preservation

`bun test` must pass with **no test changes**. By the time this
PR runs, every test has been updated to match the specific-variant
output by 4a–4g. Removing `untriaged` shouldn't affect any
running code path because no code path uses it anymore.

This PR adds no new tests beyond removing the `untriaged` ones.

## Forbidden shortcuts

- **Don't run before 4a–4g.** Verify with `grep -rn
  "diag\.untriaged" compiler/src/` returning empty before starting.
- **Don't leave a deprecated alias.** Full deletion per §9.
- **Don't widen scope.** Specifically: don't refactor the
  `src/diagnostics/` interface while you're there.
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Verify the gate:

   ```bash
   grep -rn "diag\.untriaged\|kind: 'untriaged'\|kind: \"untriaged\"" compiler/src/ | wc -l
   ```

   Must be `0`. If non-zero, list the surviving sites and stop —
   one of 4a–4g is incomplete.

2. Remove the `untriaged` arm from
   `compiler/src/diagnostics/types.ts`. TS will start failing
   anywhere `untriaged` is referenced; that's the surface area to
   clean up.

3. Remove the `untriaged` case from
   `compiler/src/diagnostics/format.ts`. TS exhaustiveness should
   now hold without the `untriaged` arm — the four-to-seven
   `E1xxx`–`E7xxx` ranges from 4a–4g cover the union.

4. Remove the `diag.untriaged({...})` typed method from
   `compiler/src/diagnostics/index.ts`.

5. Delete `compiler/src/errors/diagnostic.ts`. Update
   `compiler/src/errors/index.ts` (re-export removal). If
   `compiler/src/errors/` becomes empty, remove the directory.

6. Update `compiler/CLAUDE.md`'s "Where to add a feature" table.
   Make sure a reader landing on the table understands that new
   diagnostics live at `src/diagnostics/` and follow the
   catalog-as-source-of-truth shape. One row updated; don't
   restructure the table.

7. Remove any leftover `untriaged` test fixtures from
   `compiler/tests/diagnostics/`.

8. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no new failures
bunx biome check src/ tests/      # must report no issues
```

Plus the post-deletion sanity checks per design doc §9:

```bash
grep -rn "diag\.untriaged" compiler/src/                # must be empty
grep -rn "kind: ['\"]untriaged['\"]" compiler/src/      # must be empty
ls compiler/src/errors/diagnostic.ts                    # must not exist
```

If any of those fail, stop and report.

## Output

**Commit messages.**

```
refactor(diagnostics): remove untriaged catch-all
chore(errors): delete legacy src/errors/diagnostic.ts
docs(compiler): point CLAUDE.md table at src/diagnostics/
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR N+1; this
  directory uses `pr-5.md` filename) for the Diagnostics module
  migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Removes the `untriaged` arm from the `Diagnostic` union now that
  4a–4g have migrated all 162 sites to specific variants
- Deletes legacy `src/errors/diagnostic.ts` and updates
  `compiler/CLAUDE.md`'s "Where to add a feature" table

## Test plan
- [ ] `bun test` passes (no regressions, no new tests added)
- [ ] `bunx biome check` passes
- [ ] `grep -rn "diag\.untriaged" compiler/src/` returns empty
- [ ] `compiler/src/errors/diagnostic.ts` no longer exists
```

## Escape hatches

Stop and report if:

1. The verification grep finds any surviving `diag.untriaged`
   call (a sibling PR is incomplete; identify which file/category).
2. Removing the alias breaks a non-checker file unexpectedly
   (suggests there's a consumer the migration plan missed —
   escalate).
3. `compiler/src/errors/` contains files unrelated to diagnostics
   that this PR shouldn't delete (preserve them and leave the
   directory; only remove `diagnostic.ts` plus its re-export).
4. Diff exceeds ~200 lines (this PR should be small; if it grows,
   something's off).

Report format per `_brief-template.md`.
