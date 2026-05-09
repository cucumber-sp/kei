# Brief: Monomorphization PR 5 — Delete the override stack (the payoff)

## Context (read first)

You are a fresh Claude Code session implementing PR 5 of the
**Monomorphization module** migration. **This is the payoff PR.**
The per-instantiation type-map override on `LoweringCtx` —
`currentBodyTypeMap` and `currentBodyGenericResolutions` — and
every push/pop site that maintains it disappear entirely. The
diff is mostly deletion. Before touching any code, read these
files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   especially §1 (the friction this PR removes — the override
   stack and its push/pop discipline), §4 (why Y-a makes the
   override redundant), §7.1 / §7.2 / §7.3 (alternatives that
   kept the override and were rejected because of it), §8 PR 5
   (this PR)
3. `docs/migrations/monomorphization/pr-4.md` — predecessor; this
   PR depends on baked AST decls already existing and the
   override already being a no-op for them
4. `compiler/src/kir/lowering-ctx.ts` — the current shape of
   `LoweringCtx` and the two fields about to be removed
5. `compiler/src/kir/lowering-decl.ts`,
   `compiler/src/kir/lowering-struct.ts`,
   `compiler/src/kir/lowering-types.ts` — the push/pop sites
6. `CONTEXT.md` — "the override stack" is a domain term referring
   to exactly this mechanism
7. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 5).

This PR is **the simplification payoff** that justified Y-a in
design doc §7. After PR 4, the override stack is dead code: every
synthesised AST decl already carries concrete resolved types, so
lowering reads them directly without consulting any
per-instantiation override. PR 5 removes the dead code.

Lowering treats synthesised decls identically to user-written
ones. No "is this generic?" branching. No push/pop discipline
for the body of a generic decl. The `LoweringCtx` field set
shrinks by two; lowering files lose every line that maintained
those fields.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-ctx.ts` — remove the
  `currentBodyTypeMap` field. Remove the
  `currentBodyGenericResolutions` field. Remove any helper
  methods that operate on those fields (push, pop, accessors).
  The class definition shrinks.
- **MODIFIED** `compiler/src/kir/lowering-decl.ts` — remove the
  push/pop sites at lines ~290 and ~301 (line numbers
  approximate; resolve via `rg` from the code as it stands when
  this PR begins). Whatever surrounding control flow existed
  only to set up / tear down the override goes with them.
- **MODIFIED** `compiler/src/kir/lowering-struct.ts` — remove
  the read site at line ~147 (approximate). Replace with the
  direct read of the decl's resolved types.
- **MODIFIED** `compiler/src/kir/lowering-types.ts` — remove the
  read site at line ~20 (approximate). Replace with the direct
  read.
- **MODIFIED** `compiler/src/kir/lowering-expr.ts` — remove any
  reference to the two fields if present. Find via `rg`.
- **MODIFIED** any other lowering file the override leaks into —
  find via the `rg` command in the verification recipe before
  starting.

**Out of scope (do not touch in this PR):**

- **Don't keep a placeholder or stub override "for safety."**
  Design doc §8 calls for full removal. The override existed
  only because lowering needed per-instantiation type
  resolution; Y-a moved that work to bake-time. There is no
  remaining reason for the field to exist.
- **Don't widen scope to other LoweringCtx fields.** Other
  fields are `#40`'s territory (LoweringCtx hygiene cleanup).
  This PR only removes the two monomorphization-specific
  fields.
- **Don't reformat unrelated code in lowering files.** Biome
  must report changes only in lines you removed and the
  immediately surrounding edits required to keep the file
  syntactically valid.
- **Don't change pass 3.** It already runs against synthesised
  decls (PR 4); the override removal is invisible to pass 3.
- **Don't change `Monomorphization`'s interface.** Products,
  accessors, `checkBodies`, `register`, `adopt` all stay
  identical to PR 4's shape.
- **Don't fold "is this from a monomorphization?" branches.**
  Those should already be gone by now; if any straggler remains,
  it's PR 6's job to catch it.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes.
Since PR 4 made the override a no-op for synthesised decls — and
PR 4's behaviour-preservation property covered the case where
the override was non-empty for non-synthesised decls (there are
no such decls in the new pipeline) — removing the override
cannot change behaviour. If a test fails, that's evidence that
PR 4 left a non-no-op path; investigate, don't update the test.

**New tests this PR adds:** none. The tests added in PRs 1–4
already cover the surface that PR 5 simplifies. The behaviour
this PR preserves is "lowering still produces the same KIR for
the same inputs" — covered by every existing end-to-end test.

## Forbidden shortcuts

- **Don't keep a placeholder / stub override "for safety."** The
  design doc §8 calls for full removal. Adding a stub creates
  exactly the friction this migration was designed to eliminate.
- **Don't widen scope to other `LoweringCtx` fields.** Those are
  `#40`'s scope. Touching them here mixes two concerns into one
  diff and complicates review.
- **Don't reformat unrelated code in lowering files.** Biome
  must report changes only in lines you removed and the minimal
  surrounding edits.
- **Don't introduce a "is this generic?" branch in lowering.**
  Synthesised decls are just-another-AST-decl. If a branch feels
  necessary somewhere, you're likely missing a substitution
  in PR 4's bake — stop and report.
- **Don't change any test.** If a test starts failing after the
  override is removed, that's evidence PR 4 left a leak; the
  fix is in PR 4 territory, not here.

## Implementation steps

1. Run `rg 'currentBodyTypeMap|currentBodyGenericResolutions' compiler/src/`
   to enumerate every site that reads or writes the two fields.
   This is the master to-do list for the PR.
2. In `lowering-ctx.ts`, delete the two fields and any helpers
   that exclusively operate on them.
3. In each lowering file from step 1's list, delete the push/pop
   site or read site. For read sites, replace with the direct
   read of the decl's resolved type (the synthesised decl
   carries it).
4. Re-run `rg 'currentBodyTypeMap|currentBodyGenericResolutions' compiler/src/`
   — must match nothing.
5. Run `bun test` and `bunx biome check`. Both must pass.
6. Sanity-pass: open `lowering-decl.ts`, `lowering-struct.ts`,
   `lowering-types.ts` and confirm no "is this generic?"
   branching remains in the touched regions. If any does, leave
   it for PR 6 (don't fold here — different PR scope).

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'currentBodyTypeMap|currentBodyGenericResolutions' src/   # nothing
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
refactor(kir): drop per-instantiation type-map override from LoweringCtx
refactor(kir): inline resolved types from synthesised decls in lowering
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 5 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- The payoff: deletes `LoweringCtx.currentBodyTypeMap` and
  `currentBodyGenericResolutions`, plus every push/pop site in
  `lowering-{decl,struct,types,expr}.ts`
- Lowering treats synthesised decls identically to user-written
  ones — no per-instantiation override, no push/pop discipline
- This is what made Y-a worth choosing over X or Z; PR 4 made
  the override a no-op for synthesised decls, this PR removes
  the dead code

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'currentBodyTypeMap|currentBodyGenericResolutions' src/` matches nothing
```

## Escape hatches

Stop and report if:

1. A test fails after the override is removed — strong signal
   that PR 4 left a leak (a code path where the override was
   non-empty for some decl shape). Don't paper over with a stub.
2. A read site in lowering needs information the synthesised
   decl doesn't carry — same signal as above; the bake in PR 4
   missed a substitution.
3. The diff turns out to be more than mostly-deletion (i.e. a
   significant code-rewrite is required somewhere) — likely
   means the design doc's no-op claim from PR 4 is wrong.
   Stop and report.
4. A surprising file outside the lowering directory references
   `currentBodyTypeMap` or `currentBodyGenericResolutions`. The
   override should be lowering-internal; an external reference
   suggests a leak.

Report format per `_brief-template.md`.
