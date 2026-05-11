/**
 * Lifecycle pass — `mark_moved` rewrite (PR 4d).
 *
 * Per `docs/design/lifecycle-module.md` §7/§9, lowering emits a
 * `mark_moved x` marker at every `move x` site instead of mutating a
 * lowering-time `movedVars` set. The Lifecycle pass walks markers in
 * source order, building a per-function moved-set, and consults it
 * when:
 *
 *   - rewriting `mark_scope_exit` — skip moved vars in the destroy
 *     sequence, alongside the existing early-return skip set
 *   - appending per-exit `mark_param` destroys — skip moved params
 *
 * The marker itself is consumed (stripped) by the rewriter; it leaves
 * no instruction behind.
 *
 * After PR 4e the tracked vars come from `mark_track` markers in the
 * function body (with `stack_alloc` planting the pointee struct/string
 * type); these tests build the var stream that way.
 *
 * Cases:
 *
 *   1. move a tracked local, then scope-exit → that var's destroy is
 *      skipped; other tracked vars still destroy in reverse order
 *   2. move a managed param, then function return → the per-exit
 *      `destroy` for that param is suppressed
 *   3. monotonic semantics: once `mark_moved x` fires, `x` stays moved
 *      for every subsequent scope-exit / per-exit-param emission in
 *      the function (matches today's lowering-time Set<string>, which
 *      was never cleared mid-function)
 *   4. independent moved-sets per function → moving `x` in `f` does
 *      not bleed into `g`
 *   5. the `mark_moved` marker is always stripped from the output
 *      (no instruction left behind)
 */

import { describe, expect, test } from "bun:test";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirModule,
  KirParam,
  KirScopeExitInfo,
  KirTerminator,
  KirType,
  ScopeId,
  VarId,
} from "../../src/kir/kir-types";
import { runLifecyclePass } from "../../src/lifecycle";

/** The pass doesn't consult the decision lookup for any path exercised here. */
const noDecisions = () => undefined;

function block(
  id: string,
  instructions: KirInst[],
  terminator: KirTerminator = { kind: "ret_void" }
): KirBlock {
  return { id, phis: [], instructions, terminator };
}

function fn(
  name: string,
  params: KirParam[],
  blocks: KirBlock[],
  scopeExits?: Map<ScopeId, KirScopeExitInfo>
): KirFunction {
  return {
    name,
    params,
    returnType: { kind: "void" },
    blocks,
    localCount: 0,
    lifecycleScopeExits: scopeExits,
  };
}

function moduleWith(...fns: KirFunction[]): KirModule {
  return { name: "test", globals: [], functions: fns, types: [], externs: [] };
}

/** Build a struct-typed param (KIR lowers managed structs to `ptr → struct`). */
function structParam(name: string, structName: string): KirParam {
  return {
    name,
    type: { kind: "ptr", pointee: { kind: "struct", name: structName, fields: [] } },
  };
}

/** Helper: `stack_alloc <varId>: <type>` to plant a pointee for `mark_track` resolution. */
function alloc(varId: VarId, type: KirType): KirInst {
  return { kind: "stack_alloc", dest: varId, type };
}

/** Helper: struct stack-alloc + `mark_track`. */
function trackStruct(name: string, varId: VarId, structName: string, scopeId: ScopeId): KirInst[] {
  return [
    alloc(varId, { kind: "struct", name: structName, fields: [] }),
    { kind: "mark_track", varId, name, scopeId },
  ];
}

describe("runLifecyclePass — mark_moved rewrite (PR 4d)", () => {
  test("moved local at scope-exit → its destroy is skipped; siblings still destroy", () => {
    // Source-order analogue:
    //   let a = S.make()
    //   let b = S.make()
    //   let c = S.make()
    //   _ = move b
    //   // scope exit → destroy c, destroy a   (b suppressed by mark_moved)
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, { skipNames: new Set() }]]);
    const before = moduleWith(
      fn(
        "f",
        [],
        [
          block("entry", [
            ...trackStruct("a", "%a", "S", 0),
            ...trackStruct("b", "%b", "S", 0),
            ...trackStruct("c", "%c", "S", 0),
            { kind: "mark_moved", var: "b" },
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    const insts = after.functions[0]?.blocks[0]?.instructions ?? [];
    // Filter out the stack_alloc plumbing — we only care about the destroys.
    const destroys = insts.filter((i) => i.kind === "destroy");
    expect(destroys).toEqual([
      { kind: "destroy", value: "%c", structName: "S" },
      { kind: "destroy", value: "%a", structName: "S" },
    ]);
  });

  test("moved param at function return → per-exit destroy is suppressed", () => {
    // Two managed params; we move `p` before the return. Only `q` is
    // destroyed at the exit terminator.
    const before = moduleWith(
      fn(
        "f",
        [structParam("p", "Bag"), structParam("q", "Bag")],
        [
          block("entry", [
            { kind: "mark_param", param: "%p" },
            { kind: "mark_param", param: "%q" },
            { kind: "mark_moved", var: "p" },
          ]),
        ]
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      { kind: "destroy", value: "%q", structName: "Bag" },
    ]);
  });

  test("moved-set is monotonic per function across multiple scope-exits", () => {
    // Two sibling scopes in one function: a `mark_moved x` in the first
    // scope must continue to suppress `x`'s destroy at the second
    // scope-exit too (matches today's lowering-time Set<string>, which
    // wasn't cleared mid-function).
    //
    //   scope 0:           scope 1:
    //     mark_moved x       (no further moves)
    //     mark_scope_exit    mark_scope_exit
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([
      [0, { skipNames: new Set() }],
      [1, { skipNames: new Set() }],
    ]);
    const before = moduleWith(
      fn(
        "f",
        [],
        [
          block("entry", [
            ...trackStruct("x", "%x0", "S", 0),
            ...trackStruct("x", "%x1", "S", 1),
            ...trackStruct("y", "%y", "S", 1),
            { kind: "mark_moved", var: "x" },
            { kind: "mark_scope_exit", scopeId: 0 },
            { kind: "mark_scope_exit", scopeId: 1 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    // Scope 0: `x` moved → nothing emitted.
    // Scope 1: `x` still moved → only `y` destroyed (reverse order
    //   would be y then x; `x` is suppressed).
    const insts = after.functions[0]?.blocks[0]?.instructions ?? [];
    const destroys = insts.filter((i) => i.kind === "destroy");
    expect(destroys).toEqual([{ kind: "destroy", value: "%y", structName: "S" }]);
  });

  test("moved-sets are independent across functions", () => {
    // Function `f` moves `x`; function `g` also has a tracked `x` and
    // no move. `f`'s marker must not bleed into `g`'s rewrite.
    const fScope = new Map<ScopeId, KirScopeExitInfo>([[0, { skipNames: new Set() }]]);
    const gScope = new Map<ScopeId, KirScopeExitInfo>([[0, { skipNames: new Set() }]]);
    const before = moduleWith(
      fn(
        "f",
        [],
        [
          block("entry", [
            ...trackStruct("x", "%fx", "S", 0),
            { kind: "mark_moved", var: "x" },
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        fScope
      ),
      fn(
        "g",
        [],
        [
          block("entry", [
            ...trackStruct("x", "%gx", "S", 0),
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        gScope
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    // `f`: move suppresses destroy.
    const fDestroys = (after.functions[0]?.blocks[0]?.instructions ?? []).filter(
      (i) => i.kind === "destroy"
    );
    expect(fDestroys).toEqual([]);
    // `g`: no move → destroy fires normally.
    const gDestroys = (after.functions[1]?.blocks[0]?.instructions ?? []).filter(
      (i) => i.kind === "destroy"
    );
    expect(gDestroys).toEqual([{ kind: "destroy", value: "%gx", structName: "S" }]);
  });

  test("`mark_moved` marker leaves no instruction behind", () => {
    // The marker is consumed by the rewriter; it must not survive to
    // mem2reg / C emitter.
    const before = moduleWith(fn("f", [], [block("entry", [{ kind: "mark_moved", var: "x" }])]));
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([]);
  });

  test("moved local across blocks → still suppressed at a later block's scope-exit", () => {
    // `mark_moved x` in `entry`, `mark_scope_exit` in a successor
    // block. The moved-set lives at the function level, so the
    // suppression must carry across blocks.
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, { skipNames: new Set() }]]);
    const before = moduleWith(
      fn(
        "f",
        [],
        [
          block("entry", [...trackStruct("x", "%x", "S", 0), { kind: "mark_moved", var: "x" }], {
            kind: "jump",
            target: "exit",
          }),
          block("exit", [{ kind: "mark_scope_exit", scopeId: 0 }]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    // entry: `mark_moved` stripped, stack_alloc + mark_track remain (mark_track stripped).
    const entryDestroys = (after.functions[0]?.blocks[0]?.instructions ?? []).filter(
      (i) => i.kind === "destroy"
    );
    expect(entryDestroys).toEqual([]);
    // exit: scope-exit consults the function-level moved-set; `x` skipped.
    expect(after.functions[0]?.blocks[1]?.instructions).toEqual([]);
  });
});
