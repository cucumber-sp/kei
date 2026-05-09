# Brief: Monomorphization PR 1 — Stand up `src/monomorphization/`

## Context (read first)

You are a fresh Claude Code session implementing PR 1 of the
**Monomorphization module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   especially §1 (why), §2 (what), §3 (sub-concerns), §4 (Y-a:
   the synthesised-AST decision), §8 PR 1 (this PR)
3. `CONTEXT.md` — domain glossary; "Monomorphization", "Y-a",
   "baked product" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 1).

This PR is **pure file relocation**. The pure helpers that today
live in `src/checker/generics.ts` move into a new
`src/monomorphization/` module. No behaviour change. No data
flow change. No new types. The maps still live on `Checker`;
that moves in PR 2. Pass-3 driving still in `Checker`; that
moves in PR 3. Y-a baking is PR 4. The override deletion is PR 5.

This PR exists so PRs 2–5 don't have to also justify the
directory creation in their diff.

**Files affected:**

- **NEW** `compiler/src/monomorphization/substitute.ts` — moves
  `substituteType` and `substituteFunctionType` from
  `checker/generics.ts`. Identical implementation.
- **NEW** `compiler/src/monomorphization/mangle.ts` — moves
  `mangleGenericName` from `checker/generics.ts`. Identical
  implementation.
- **NEW** `compiler/src/monomorphization/types.ts` — moves the
  `MonomorphizedStruct` and `MonomorphizedFunction` interface
  exports from `checker/generics.ts`. Identical shapes.
- **NEW** `compiler/src/monomorphization/index.ts` — re-exports
  everything in the module for ergonomic imports.
- **MODIFIED** `compiler/src/checker/generics.ts` — becomes a
  thin re-export shim (`export * from
  "../monomorphization"`). Documented as a transition file in
  a header comment; deleted in PR 6.
- **MODIFIED** every file that imports from `checker/generics.ts`
  — switch the import path to `"../monomorphization"` (or
  whatever the relative path is from that file's location).
  Find these via `rg "from .*generics"` from
  `compiler/src/`.

**Out of scope (do not touch in this PR):**

- The maps on `Checker` (`monomorphizedStructs` /
  `Functions` / `Enums`) stay where they are. PR 2 moves them.
- The cross-module adoption methods (`adoptMonomorphizedX`)
  stay on `Checker`. PR 2 moves them.
- Pass-3 body-checking driver stays in `Checker`. PR 3 moves
  it.
- Don't introduce a `Monomorphization` factory or interface
  yet — PR 2 introduces the constructed-and-threaded shape.
- Don't touch any KIR lowering file. The override on
  `LoweringCtx` stays. PR 5 deletes it.
- Don't change any function signature.

## Behaviour preservation

Every test in `compiler/tests/` must pass. The diff should be
**imports + file moves only** — no logic changes. If you find
yourself rewriting a function, stop; that's out of scope.

**New tests this PR adds:** none. Pure relocation; existing
tests cover the moved functions.

## Forbidden shortcuts

- **Don't combine the relocated files.** Each gets its own
  source file (`substitute.ts`, `mangle.ts`, `types.ts`) — the
  design doc §3 maps to that structure, and PR 4+ will add
  more files alongside.
- **Don't delete `checker/generics.ts`.** It stays as a
  re-export shim for transition. Deletion is PR 6.
- **Don't update import paths to use the re-export shim.**
  Every concrete file that previously imported
  `from "./generics"` must now import
  `from "../monomorphization"` directly. The shim exists for
  any file we missed; it should be unused once this PR ships.
  (Verify this with `rg 'from .*generics' compiler/src/`
  before opening the PR — only the shim file itself should
  match.)
- **Don't reformat the moved code.** Move verbatim. Biome
  must report no changes other than the new files and the
  modified imports.
- **Don't widen scope.** If you spot friction in `generics.ts`
  unrelated to relocation, note it for the relevant later PR
  (probably PR 4) and move on.

## Implementation steps

1. Create `src/monomorphization/` directory.
2. Create `substitute.ts` and copy `substituteType` +
   `substituteFunctionType` verbatim. Update imports inside the
   moved file (paths shift one level).
3. Create `mangle.ts` and copy `mangleGenericName` verbatim.
4. Create `types.ts` and copy the `MonomorphizedStruct` and
   `MonomorphizedFunction` interface exports verbatim.
5. Create `index.ts` re-exporting everything.
6. Modify `checker/generics.ts` to a thin shim:
   ```ts
   // transition only: re-export for files we haven't migrated.
   // delete in PR 6 of the monomorphization migration.
   export * from "../monomorphization";
   ```
7. Run `rg 'from .*generics' compiler/src/` to find every
   importer. For each, switch the path to point at
   `../monomorphization` (or the appropriate relative path).
8. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'from .*generics' src/         # only the shim file should match
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
refactor(monomorphization): relocate substitute/mangle/types from checker/generics
chore(checker): keep generics.ts as transition re-export shim
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 1 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Pure relocation: `substituteType`, `substituteFunctionType`,
  `mangleGenericName`, and the `MonomorphizedStruct/Function`
  types move from `src/checker/generics.ts` to a new
  `src/monomorphization/` module
- `src/checker/generics.ts` becomes a transition re-export shim
  (deleted in PR 6)
- No behaviour change; the maps and pass-3 driver remain on
  `Checker` until PRs 2 and 3

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'from .*generics' src/` matches only the shim file
```

## Escape hatches

Stop and report if:

1. A circular import emerges from relocating types — likely
   means a deeper structural assumption the design doc didn't
   anticipate.
2. The re-export shim trick interacts badly with TS config
   (paths, module resolution).
3. The diff exceeds ~700 lines of moved code — suggests there
   was more in `generics.ts` than the design doc captured.

Report format per `_brief-template.md`.
