# Brief: Lifecycle PR 3 — Pass slot, no-op rewrite

## Context (read first)

You are a fresh Claude Code session implementing PR 3 of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §2
   (what), §3 (Marker IR — required reading for this PR), §7 PR 3
   (this PR), §9 (tests)
3. `docs/migrations/lifecycle/pr-1.md` and `pr-2.md` — the prior
   PRs; Decide and Synthesise already live in `src/lifecycle/`
4. `CONTEXT.md` — domain glossary; "Insert pass", "marker IR",
   "Lifecycle" have specific meanings
5. `compiler/CLAUDE.md` — how to build / test / lint; KIR
   instruction-kind layout is in `src/kir/kir-types/`

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**Prerequisite.** PR 2 (Synthesise moves out) must be merged
first. **Follow-on.** PRs 4a–4e cut over insertion sites once
PR 3 is in place; this PR adds the slot they fill, but commits
to no insertion-site migration itself.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 3 —
"Pass slot, no-op rewrite").

This PR introduces the **marker KIR instructions** and the
**Lifecycle rewrite pass**. The pass slots between KIR lowering
and mem2reg. *The pass starts as a no-op rewriter*: it walks the
KIR, strips any marker instructions it finds, and emits no
concrete `destroy` / `oncopy` instructions of its own. The
existing scattered insertion logic (`lowering-scope.ts`,
`lowering-expr.ts`, `lowering-decl.ts`) keeps running in
parallel — markers and old logic do not overlap, because no
lowering site emits markers yet.

The point of this PR is **infrastructure without commitment**.
The pass slot, the marker types, the printer cases, and the
test scaffolding all land. Cutting over actual insertion sites
is PRs 4a–4e.

**Files affected:**

- **NEW / MODIFIED** `compiler/src/kir/kir-types/` — add the six
  marker instruction kinds per design doc §3:
  `mark_scope_enter` (operand: `scope_id`), `mark_scope_exit`
  (operand: `scope_id`), `mark_track` (operands: `var,
  scope_id`), `mark_moved` (operand: `var`), `mark_assign`
  (operands: `slot, new_value, is_move`), `mark_param` (operand:
  `param`). Match the existing instruction-kind module layout
  in `src/kir/kir-types/`.
- **NEW** `compiler/src/lifecycle/pass.ts` — the rewrite pass.
  Signature: `runLifecyclePass(module, decisions) → module`.
  Walks every block; for each marker instruction, drops it.
  Non-marker instructions are passed through unchanged. After
  the pass, no `mark_*` instruction survives.
- **MODIFIED** `compiler/src/lifecycle/index.ts` — re-export
  `runLifecyclePass`.
- **MODIFIED** the KIR pipeline driver (wherever lowering hands
  off to mem2reg — likely `src/kir/index.ts` or the compile
  driver) to call `lifecycle.runLifecyclePass(module,
  decisionMap)` between lowering and mem2reg. Confirm the seam
  by reading the call site, not by guessing.
- **MODIFIED** `compiler/src/kir/printer.ts` — add cases for
  the six new instruction kinds so KIR serialisation
  exhaustively handles them. Format mirrors existing
  instruction-printing conventions.
- **NEW** `compiler/tests/lifecycle/pass.test.ts` — pure
  rewrite-pass tests on synthetic KIR inputs.
- **NEW** `compiler/tests/kir/printer-markers.test.ts` (or add
  to an existing `printer.test.ts` if convention) — snapshot
  tests for printer output on each marker kind.

**Out of scope (do not touch in this PR):**

- Don't migrate any insertion site to markers. No
  `lowering-scope.ts` / `lowering-expr.ts` / `lowering-decl.ts`
  edit emits a marker. Those changes are PRs 4a–4e.
- Don't delete the existing scattered insertion logic. It stays
  running in parallel — the cutover happens one site at a time
  in PR 4.
- Don't add type information to markers. `mark_track`,
  `mark_assign`, etc. carry vars/slots/params, not types. Type
  is read off the var's KIR type at rewrite time per design doc
  §3 (this is deliberate — keeps markers type-agnostic for the
  planned String stdlib migration).
- Don't add `mark_early_return` or `mark_loop_break`. Per design
  doc §3, every actual exit point just emits `mark_scope_exit`
  for each scope being unwound; the pass treats them uniformly.
- Don't add `mark_string_*` distinct from `mark_struct_*`. Same
  type-agnostic reason.
- Don't rename the existing concrete `destroy` / `oncopy` KIR
  instructions. Markers eventually rewrite *to* those — they
  are different kinds.
- Don't touch the PR-1 `methods.set("__destroy", …)` shim or
  the PR-2 synthesise call. They are unaffected.
- Don't touch `backend/`. The pass runs before mem2reg, so the
  backend never sees markers.

## Behaviour preservation

The full test suite (`bun test`) **must pass with no test
changes** other than the new tests this PR adds. Because no
lowering site emits markers in this PR, the rewrite pass has
nothing to strip on real inputs — the pass is observably a
no-op against the test suite.

If `tests/kir/` snapshots change, the pass is rewriting
something it shouldn't (or the printer changes leaked into
unrelated output). Investigate, don't update snapshots.

**New tests this PR adds** (per design doc §9 — pass tests on
synthetic inputs, plus printer coverage):

- `compiler/tests/lifecycle/pass.test.ts` — synthetic KIR
  module input + decision map, snapshot the pass output:
  - empty module → unchanged
  - module with no markers → unchanged (proves the pass is a
    no-op when there's nothing to rewrite)
  - module with each marker kind in isolation → marker stripped,
    no concrete `destroy` / `oncopy` emitted (since this PR's
    pass is a no-op rewriter, not yet a real one)
  - module mixing markers and non-markers → non-markers pass
    through in original order, markers gone
- `compiler/tests/kir/printer-markers.test.ts` — for each of the
  six marker kinds, print a representative instance and
  snapshot the output. Confirms `printer.ts` exhaustively
  handles the new kinds.

These tests use synthetic KIR (constructed by the test, not
emitted by lowering). The Lifecycle pass is now testable
*without* a frontend driver.

## Forbidden shortcuts

- **Don't migrate any insertion site to markers in this PR.**
  PRs 4a–4e cut over one site at a time. Mixing infra-introduction
  with cutover defeats the staged migration.
- **Don't delete the existing scattered insertion logic.** The
  old paths stay running until PR 4 cuts over each site. The
  invariant is: *no lowering site emits markers yet, so old
  logic and markers do not overlap.*
- **Don't add type information to markers.** Per design doc §3,
  type is re-read off the var's KIR type at rewrite time.
  Adding it now bakes the wrong shape and forces churn when
  String becomes a managed struct.
- **Don't rename `destroy` / `oncopy` KIR instructions.** Those
  are concrete instructions that markers will eventually
  rewrite to. They must coexist with the new `mark_*` kinds.
- **Don't make the pass do real work.** It strips markers and
  passes everything else through. A "while we're here, also
  rewrite X" is exactly the cutover this PR defers to PR 4.
- **Don't add new instruction kinds beyond the six in design
  doc §3.** Six markers, no more. If you think a seventh is
  needed, stop and report.
- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in your PR scope should appear.
- **Don't introduce new dependencies.** `package.json` must not
  change.
- **Don't widen scope.** Friction in `kir-types/` or
  `printer.ts` unrelated to markers goes to a fresh GitHub
  issue.

## Implementation steps

1. Read `src/kir/kir-types/` and identify the existing
   instruction-kind module layout (one file per family,
   discriminated-union arm per kind, exhaustive switch
   contracts in printer / lowering / backend). Match the
   convention exactly when adding the six `mark_*` kinds.
2. Add the six marker instruction kinds per design doc §3.
   Operands are listed in the §3 table — encode them in
   discriminated-union arms with the correct shape (vars,
   slot/value, scope_id, etc.). No type fields on
   `mark_track` / `mark_assign`.
3. Update `src/kir/printer.ts` to handle each new kind. The
   printer's switch must remain exhaustive; TypeScript strict
   mode will catch any missing arm.
4. Create `src/lifecycle/pass.ts` exposing
   `runLifecyclePass(module, decisions) → module`. Walk every
   function, every block, every instruction. For instructions
   matching any `mark_*` kind, drop them. For all others, emit
   them unchanged. The decision map parameter is plumbed
   through but unused in this PR — it lands here so PR 4a
   doesn't have to change the signature.
5. Re-export `runLifecyclePass` from `src/lifecycle/index.ts`.
6. Wire the pass into the KIR pipeline. Find the call site
   where lowering hands off to mem2reg. Insert
   `lifecycle.runLifecyclePass(module, decisionMap)` between
   them. The decision map comes from the Lifecycle instance
   constructed at checker time (PR 1).
7. Add `tests/lifecycle/pass.test.ts` per the test list above.
   Build synthetic KIR by hand using the kir-types
   constructors. Snapshot the pass output.
8. Add the printer marker tests. Snapshot one print per marker
   kind to confirm the new switch arms produce stable output.
9. Run the full verification recipe. Existing tests must be
   unchanged: no lowering site emits markers, so the pass sees
   none in real compiles.

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
feat(kir): add mark_* instruction kinds for lifecycle markers
feat(lifecycle): introduce runLifecyclePass (no-op rewriter slot)
feat(kir): wire lifecycle pass between lowering and mem2reg
test(lifecycle): cover pass strip-markers behaviour on synthetic KIR
test(kir): snapshot printer output for marker instructions
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 3 of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds the six `mark_*` KIR instruction kinds per design doc §3
  (`mark_scope_enter`, `mark_scope_exit`, `mark_track`,
  `mark_moved`, `mark_assign`, `mark_param`)
- Adds `lifecycle.runLifecyclePass`, slotted between lowering
  and mem2reg. The pass strips markers and is otherwise a no-op
- No lowering site emits markers yet; existing scattered
  insertion logic continues unchanged. PRs 4a–4e cut over one
  site at a time.
- KIR `printer.ts` exhaustively handles the new instruction
  kinds.

## Test plan
- [ ] `bun test` passes (no regressions — pass is observably a
      no-op against the existing suite)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass.test.ts` exercises the rewrite
      against synthetic KIR (empty marker → no-op; mixed
      markers + non-markers → markers stripped, rest preserved)
- [ ] New printer snapshots cover all six marker kinds
```

## Escape hatches

If you hit one of these, **stop and report**:

1. The KIR pipeline driver doesn't have a clean seam between
   lowering and mem2reg (e.g. lowering and mem2reg are
   interleaved, or there's no single hand-off site). Report —
   the design doc's "slot the pass between lowering and
   mem2reg" assumes a seam that may need to be created first.
2. Adding the six instruction kinds forces edits in places the
   design doc didn't predict (e.g. de-SSA, C emitter, or
   mem2reg insists on handling them). The pass should run
   *before* mem2reg, so downstream stages should never see
   markers — if they do, something is wrong with the pipeline
   wiring.
3. The diff exceeds ~700 lines added (suggests the pass is
   doing more than strip-and-pass-through, or instruction-kind
   plumbing has fanned out further than expected).
4. You find that one of the six markers in §3 is insufficient
   for a future cutover (e.g. PR 4a needs information not
   carried by `mark_scope_exit`). Report — the design doc gets
   updated, not bypassed.

**Report format.** A single message with:

1. What blocked
2. What you tried
3. Diff size and which tests failed (if applicable)
4. Whether you think this is a brief problem, design-doc
   problem, or implementation-judgment call

Don't ask for permission to continue past a blocker — report and
wait. The orchestrating session decides.
