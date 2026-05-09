# Brief: Lifecycle PR 2 — Synthesise moves out

## Context (read first)

You are a fresh Claude Code session implementing PR 2 of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §2
   (what), §4 (Decision shape), §7 PR 2 (this PR), §9 (tests)
3. `docs/migrations/lifecycle/pr-1.md` — the prior PR; the
   `src/lifecycle/` module landed there. PR 2 builds on it.
4. `CONTEXT.md` — domain glossary; "Lifecycle", "Synthesise",
   "Decision", "Managed type" have specific meanings
5. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**Prerequisite.** PR 1 (Decide moves out) must be merged first.
This PR depends on `src/lifecycle/` existing, on
`LifecycleDecision` / `ManagedFieldRef` being defined in
`src/lifecycle/types.ts`, and on `lifecycle.getDecision(struct)`
returning the populated decision after the fixed-point has run.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 2 —
"Synthesise moves out").

This PR moves the **Synthesise** sub-concern out of
`src/kir/lowering-struct.ts` into the new `src/lifecycle/`
module. The hook-body generator that today lives inside lowering
becomes `lifecycle.synthesise(struct, decision) → KirFunction[]`,
called from the same site in `lowering-struct.ts`. Behaviour is
unchanged — a relocation, not a rewrite.

**Files affected:**

- **NEW** `compiler/src/lifecycle/synthesise.ts` — the
  `synthesise(struct, decision) → KirFunction[]` entry point.
  Body is the existing hook-generation code from
  `lowering-struct.ts`, lifted as-is. Reads field iteration order
  off the struct in reverse declaration order (spec §6.9) — that
  ordering is the module's invariant, not the caller's.
- **MODIFIED** `compiler/src/lifecycle/index.ts` — re-export
  `synthesise` from the module so callers import via
  `src/lifecycle/`.
- **MODIFIED** `compiler/src/kir/lowering-struct.ts` — replace
  the inline hook-body generation with a single call to
  `lifecycle.synthesise(struct, decision)`. The KIR functions
  returned are emitted into the KIR module exactly as before.
- **NEW** `compiler/tests/lifecycle/synthesise.test.ts` — pure,
  table-driven snapshot tests per design doc §9.

**Out of scope (do not touch in this PR):**

- The Insert sub-concern stays scattered as today. Markers and
  the rewriting pass land in PR 3.
- Don't change synthesis semantics. The KIR emitted for any
  struct must be byte-identical (modulo SSA value-numbering, if
  any internal numbering differs between call sites — it
  shouldn't, since the algorithm is unchanged).
- Don't fold `decide` and `synthesise` into one call. They stay
  separate per design doc §2 — the checker/KIR phase split
  forces it (Decide runs at checker time before bodies are
  type-checked; Synthesise runs at lowering time after
  monomorphization has produced concrete field types).
- Don't introduce marker IR instructions. Those are PR 3.
- Don't touch the override stack on `LoweringCtx`. That's
  Monomorphization migration territory.
- Don't remove the `struct-checker.ts`
  `methods.set("__destroy", …)` shim from PR 1 — it stays until
  PR 4.
- Don't touch `backend/` or anything downstream of KIR.

## Behaviour preservation

The full test suite (`bun test`) **must pass with no test
changes** other than the new tests this PR adds. Pay particular
attention to:

- `tests/kir/` cases that snapshot lowered KIR for managed
  structs (anything containing strings or nested managed structs)
- `tests/e2e/run.test.ts` cases that exercise `__destroy` /
  `__oncopy` against compiled binaries

If a KIR snapshot diff appears under `tests/kir/`, the
relocation has changed semantics — that's a regression, not a
test to update.

**New tests this PR adds** (per design doc §9 — Synthesise
tests):

- `compiler/tests/lifecycle/synthesise.test.ts` — pure,
  table-driven, snapshot-against-golden:
  - struct with one string field → `__destroy` body that
    destroys that field; no `__oncopy`
  - struct with one string field marked managed-on-copy →
    `__oncopy` body that re-copies the field
  - struct with multiple managed fields → fields appear in
    reverse declaration order in `__destroy`
  - struct with mixed managed + plain fields → only managed
    fields appear in the body
  - struct with a nested managed struct field → body destroys
    via the nested struct's `__destroy`, not by inlining
  - empty decision (no managed fields) → empty `KirFunction[]`

Use the existing `tests/kir/*.test.ts` files for snapshot
conventions. The point of these tests is that Synthesise is now
testable *without* a checker driver — feed a synthetic struct +
synthetic Decision, assert on the produced KIR.

## Forbidden shortcuts

- **Don't change synthesis logic semantics.** This is a
  relocation. If you find a bug in the existing generator, file
  it with `gh issue create` and link from the PR description.
  Don't fix it here.
- **Don't merge Decide and Synthesise into one call.** Per
  design doc §2, the phase split is forced by the checker/KIR
  boundary. A single-call API would couple them again and
  defeat the migration's whole point.
- **Don't introduce marker IR yet.** Synthesise produces
  concrete `__destroy` / `__oncopy` `KirFunction` bodies — same
  as today. Marker instructions land in PR 3.
- **Don't touch `LoweringCtx`'s override stack.** That state
  belongs to the Monomorphization migration; reaching into it
  here widens scope and risks tangling two concept migrations.
- **Don't remove the PR-1 type-table shim.** The
  `structType.methods.set("__destroy", …)` in
  `struct-checker.ts` is load-bearing for type-checking
  `s.__destroy()` call sites. PR 4 removes it.
- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in your PR scope should appear.
- **Don't introduce new dependencies.** `package.json` must not
  change.
- **Don't widen scope.** Friction in `lowering-struct.ts`
  unrelated to lifecycle goes to a fresh GitHub issue.

## Implementation steps

1. Read the existing hook-body generator in
   `src/kir/lowering-struct.ts`. Identify the function (or
   block) that produces the `__destroy` / `__oncopy`
   `KirFunction` from a struct + the existing checker-side
   decision. Note its inputs and outputs precisely — the new
   `synthesise(struct, decision)` signature must match.
2. Create `src/lifecycle/synthesise.ts`. Lift the generator body
   verbatim. Adjust only what's needed to read field info from
   the `LifecycleDecision` (PR 1 shape: `{ destroy?: { fields:
   ManagedFieldRef[] }, oncopy?: { fields: ManagedFieldRef[] }
   }`) instead of from wherever the lowering version reads it
   today.
3. Confirm the field iteration order is reverse declaration
   order (spec §6.9). If the existing generator already iterates
   that way, preserve it. If it iterates forwards and reverses
   at the end, preserve that too. The order is the *module's*
   invariant — encode it in `synthesise`, not in the decision
   shape.
4. Re-resolve field types against the struct at synthesise time
   (per design doc §4). Don't rely on types being baked into the
   decision — `ManagedFieldRef` carries only the field name.
5. Re-export `synthesise` from `src/lifecycle/index.ts`.
6. Modify `src/kir/lowering-struct.ts` to call
   `lifecycle.synthesise(struct, decision)` at the same site
   that previously inlined the generator. The decision comes
   from `lifecycle.getDecision(struct)` (introduced in PR 1).
7. Add `tests/lifecycle/synthesise.test.ts` per the test list
   above. Drive the design with the tests first (red-green
   inside this PR) — the synthesise function is now pure, so
   tests can construct synthetic structs and decisions without
   running the checker.
8. Run the full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

If either fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style in `git log`:

```
feat(lifecycle): add synthesise(struct, decision) → KirFunction[]
refactor(kir): delegate hook-body generation to lifecycle.synthesise
test(lifecycle): cover synthesise reverse-declaration order + nested managed
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 2 of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Moves the `__destroy` / `__oncopy` KIR function-body generator
  out of `kir/lowering-struct.ts` into `src/lifecycle/synthesise.ts`
- `lowering-struct.ts` now calls `lifecycle.synthesise(struct,
  decision)` at the same emission site; behaviour unchanged
- Reverse-declaration order (spec §6.9) is now the Lifecycle
  module's invariant, not the caller's

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/synthesise.test.ts` snapshots
      `__destroy` / `__oncopy` bodies for representative struct
      shapes (single managed, multiple managed in reverse order,
      nested managed, empty decision)
```

## Escape hatches

If you hit one of these, **stop and report**:

1. The existing hook-body generator turns out to depend on
   lowering-internal state (an open builder, a current block,
   `LoweringCtx` overrides) in a way the design doc didn't
   predict. Don't refactor your way around it — report so the
   design doc can be updated.
2. KIR snapshots in `tests/kir/` diff after the relocation. That
   means the move was not behaviour-preserving; investigate the
   first divergent test, don't update snapshots.
3. The diff exceeds ~500 lines added or ~300 lines deleted from
   `lowering-struct.ts` (suggests scope creep).
4. You discover the `LifecycleDecision` shape from PR 1 is
   insufficient for synthesise (e.g. needs more than the field
   name). Report — the design doc gets updated, not bypassed.

**Report format.** A single message with:

1. What blocked
2. What you tried
3. Diff size and which tests failed (if applicable)
4. Whether you think this is a brief problem, design-doc
   problem, or implementation-judgment call

Don't ask for permission to continue past a blocker — report and
wait. The orchestrating session decides.
