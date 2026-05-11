/**
 * Lifecycle.runLifecyclePass — pure rewrite-pass tests on synthetic KIR.
 *
 * These tests build small `KirModule`s by hand (no parser, no checker, no
 * lowering) so the pass is exercised in isolation. PR 3 lands the pass as
 * a **no-op rewriter**: every `mark_*` instruction is stripped; nothing
 * concrete (e.g. `destroy` / `oncopy`) is emitted in its place. Real
 * insertion-site behaviour is staged across PRs 4a–4e
 * (`docs/design/lifecycle-module.md` §7).
 *
 * Cases mirror `docs/design/lifecycle-module.md` §9 ("pass tests on
 * synthetic inputs"):
 *   1. empty module → unchanged
 *   2. module with no markers → unchanged
 *   3. each marker kind in isolation → marker stripped, no concrete
 *      destroy / oncopy emitted
 *   4. mixed markers + non-markers → non-markers preserved in original
 *      order, markers gone
 */

import { describe, expect, test } from "bun:test";
import type { KirBlock, KirFunction, KirInst, KirModule } from "../../src/kir/kir-types";
import { runLifecyclePass } from "../../src/lifecycle";

/** A `getDecision` that always says "no decision" — the no-op pass never reads it anyway. */
const noDecisions = () => undefined;

const VOID: { kind: "void" } = { kind: "void" };

function block(id: string, instructions: KirInst[]): KirBlock {
  return {
    id,
    phis: [],
    instructions,
    terminator: { kind: "ret_void" },
  };
}

function fn(name: string, blocks: KirBlock[]): KirFunction {
  return {
    name,
    params: [],
    returnType: VOID,
    blocks,
    localCount: 0,
  };
}

function emptyModule(): KirModule {
  return { name: "test", globals: [], functions: [], types: [], externs: [] };
}

function moduleWith(...fns: KirFunction[]): KirModule {
  return { name: "test", globals: [], functions: fns, types: [], externs: [] };
}

/** Collect every instruction kind seen across the module's blocks. */
function instructionKinds(module: KirModule): string[] {
  const kinds: string[] = [];
  for (const f of module.functions) {
    for (const b of f.blocks) {
      for (const inst of b.instructions) {
        kinds.push(inst.kind);
      }
    }
  }
  return kinds;
}

describe("runLifecyclePass — no-op rewrite (PR 3)", () => {
  test("empty module → unchanged", () => {
    const before = emptyModule();
    const after = runLifecyclePass(before, noDecisions);

    expect(after.name).toBe(before.name);
    expect(after.functions).toEqual([]);
    expect(after.globals).toEqual([]);
    expect(after.types).toEqual([]);
    expect(after.externs).toEqual([]);
  });

  test("module with no markers → instructions unchanged", () => {
    const passthroughInsts: KirInst[] = [
      { kind: "const_int", dest: "%0", type: { kind: "int", bits: 32, signed: true }, value: 42 },
      { kind: "const_bool", dest: "%1", value: true },
    ];
    const before = moduleWith(fn("noop", [block("entry", passthroughInsts)]));
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual(passthroughInsts);
  });

  test("preserves module shape (name, globals, types, externs)", () => {
    const before: KirModule = {
      name: "fixtures",
      globals: [{ name: "G", type: VOID, initializer: null }],
      functions: [],
      types: [{ name: "T", type: { kind: "struct", name: "T", fields: [] } }],
      externs: [{ name: "puts", params: [], returnType: VOID }],
    };
    const after = runLifecyclePass(before, noDecisions);

    expect(after.name).toBe("fixtures");
    expect(after.globals).toEqual(before.globals);
    expect(after.types).toEqual(before.types);
    expect(after.externs).toEqual(before.externs);
  });

  describe("strips each marker kind in isolation", () => {
    const markers: { name: string; inst: KirInst }[] = [
      { name: "mark_scope_enter", inst: { kind: "mark_scope_enter", scopeId: 1 } },
      { name: "mark_scope_exit", inst: { kind: "mark_scope_exit", scopeId: 1 } },
      { name: "mark_track", inst: { kind: "mark_track", varId: "%0", scopeId: 1 } },
      { name: "mark_moved", inst: { kind: "mark_moved", varId: "%0" } },
      {
        name: "mark_assign",
        inst: { kind: "mark_assign", slot: "%0", newValue: "%1", isMove: false },
      },
      { name: "mark_param", inst: { kind: "mark_param", param: "%p" } },
    ];

    for (const { name, inst } of markers) {
      test(`${name} → stripped, no destroy/oncopy emitted`, () => {
        const before = moduleWith(fn("f", [block("entry", [inst])]));
        const after = runLifecyclePass(before, noDecisions);

        const kinds = instructionKinds(after);
        expect(kinds).toEqual([]);
        // PR 3 is a no-op rewriter — strictly: no real destroy / oncopy yet.
        expect(kinds).not.toContain("destroy");
        expect(kinds).not.toContain("oncopy");
      });
    }
  });

  test("mixed markers + non-markers → non-markers preserved in order, markers gone", () => {
    const constA: KirInst = {
      kind: "const_int",
      dest: "%0",
      type: { kind: "int", bits: 32, signed: true },
      value: 1,
    };
    const constB: KirInst = {
      kind: "const_int",
      dest: "%1",
      type: { kind: "int", bits: 32, signed: true },
      value: 2,
    };
    const enterScope: KirInst = { kind: "mark_scope_enter", scopeId: 7 };
    const trackVar: KirInst = { kind: "mark_track", varId: "%0", scopeId: 7 };
    const exitScope: KirInst = { kind: "mark_scope_exit", scopeId: 7 };

    const before = moduleWith(
      fn("mixed", [block("entry", [enterScope, constA, trackVar, constB, exitScope])])
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([constA, constB]);
  });

  test("walks every function and every block", () => {
    const marker: KirInst = { kind: "mark_scope_exit", scopeId: 0 };
    const before = moduleWith(
      fn("a", [block("entry", [marker]), block("b1", [marker])]),
      fn("b", [block("entry", [marker])])
    );
    const after = runLifecyclePass(before, noDecisions);

    for (const f of after.functions) {
      for (const b of f.blocks) {
        expect(b.instructions).toEqual([]);
      }
    }
  });

  test("does not mutate the input module", () => {
    const marker: KirInst = { kind: "mark_scope_enter", scopeId: 0 };
    const beforeBlock = block("entry", [marker]);
    const before = moduleWith(fn("f", [beforeBlock]));

    runLifecyclePass(before, noDecisions);

    // Input must be untouched — pass returns a fresh module.
    expect(beforeBlock.instructions).toEqual([marker]);
    expect(before.functions[0]?.blocks[0]?.instructions).toEqual([marker]);
  });
});
