/**
 * Lifecycle pass — `mark_track` + `mark_scope_enter` rewrite (PR 4e).
 *
 * After PR 4e, the Lifecycle pass owns the scope → tracked-vars map: it
 * walks each function's `mark_track` markers pre-rewrite, buckets them
 * by `scopeId`, and reads the bucket back at the matching
 * `mark_scope_exit`. These tests exercise that contract on synthetic
 * KIR (no parser, no checker, no lowering driver).
 *
 * Cases (per design doc §9):
 *
 *   1. single scope with two tracked vars → destroys in reverse
 *      declaration order
 *   2. nested scopes → inner scope's tracked vars destroyed at inner
 *      `mark_scope_exit`; outer's at outer
 *   3. loop body with `break` traversing two scope frames → both sets
 *      of tracked vars destroyed inner-first, in reverse-decl order
 *   4. `mark_track` emitted in an `if` arm names the innermost
 *      `scope_id` and only fires when that scope exits
 *
 * Plus housekeeping:
 *
 *   - `mark_scope_enter` and `mark_track` are stripped after rewrite
 *     (they must not survive into mem2reg)
 *   - declaration order across blocks is preserved (the marker stream
 *     is the source of truth, not block layout)
 */

import { describe, expect, test } from "bun:test";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirModule,
  KirScopeExitInfo,
  KirType,
  ScopeId,
  VarId,
} from "../../src/kir/kir-types";
import { runLifecyclePass } from "../../src/lifecycle";

const noDecisions = () => undefined;

function block(
  id: string,
  instructions: KirInst[],
  terminator: KirBlock["terminator"] = { kind: "ret_void" }
): KirBlock {
  return { id, phis: [], instructions, terminator };
}

function fn(
  name: string,
  blocks: KirBlock[],
  scopeExits?: Map<ScopeId, KirScopeExitInfo>
): KirFunction {
  return {
    name,
    params: [],
    returnType: { kind: "void" },
    blocks,
    localCount: 0,
    lifecycleScopeExits: scopeExits,
  };
}

function moduleWith(...fns: KirFunction[]): KirModule {
  return { name: "test", globals: [], functions: fns, types: [], externs: [] };
}

function alloc(varId: VarId, type: KirType): KirInst {
  return { kind: "stack_alloc", dest: varId, type };
}

function trackStruct(name: string, varId: VarId, structName: string, scopeId: ScopeId): KirInst[] {
  return [
    alloc(varId, { kind: "struct", name: structName, fields: [] }),
    { kind: "mark_track", varId, name, scopeId },
  ];
}

function emptySkips(): KirScopeExitInfo {
  return { skipNames: new Set() };
}

/** Extract `kind` for every instruction across every block of the first function. */
function allKinds(after: KirModule): string[] {
  const kinds: string[] = [];
  for (const b of after.functions[0]?.blocks ?? []) {
    for (const inst of b.instructions) kinds.push(inst.kind);
  }
  return kinds;
}

describe("runLifecyclePass — mark_track / mark_scope_enter rewrite (PR 4e)", () => {
  test("single scope with two tracked vars → destroys in reverse declaration order", () => {
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, emptySkips()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            { kind: "mark_scope_enter", scopeId: 0 },
            ...trackStruct("a", "%a", "S", 0),
            ...trackStruct("b", "%b", "S", 0),
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%a", struct),
      alloc("%b", struct),
      { kind: "destroy", value: "%b", structName: "S" },
      { kind: "destroy", value: "%a", structName: "S" },
    ]);
  });

  test("nested scopes → inner destroys at inner exit; outer at outer exit", () => {
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([
      [0, emptySkips()],
      [1, emptySkips()],
    ]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            { kind: "mark_scope_enter", scopeId: 0 },
            ...trackStruct("outer", "%outer", "S", 0),
            { kind: "mark_scope_enter", scopeId: 1 },
            ...trackStruct("inner", "%inner", "S", 1),
            { kind: "mark_scope_exit", scopeId: 1 },
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%outer", struct),
      alloc("%inner", struct),
      // Inner scope exit fires first, destroying only the inner var.
      { kind: "destroy", value: "%inner", structName: "S" },
      // Outer scope exit then destroys only the outer var.
      { kind: "destroy", value: "%outer", structName: "S" },
    ]);
  });

  test("loop break unwinds two scopes → both sets destroy inner-first, reverse-decl order", () => {
    // Synthetic shape of a `while { ... { break; } }`: lowering emits
    // the inner `mark_scope_exit` *and* the outer `mark_scope_exit`
    // before the break-target jump, both keyed to live scope ids.
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([
      [0, emptySkips()],
      [1, emptySkips()],
    ]);
    const before = moduleWith(
      fn(
        "f",
        [
          block(
            "loop.body",
            [
              { kind: "mark_scope_enter", scopeId: 0 },
              ...trackStruct("outer_a", "%oa", "S", 0),
              ...trackStruct("outer_b", "%ob", "S", 0),
              { kind: "mark_scope_enter", scopeId: 1 },
              ...trackStruct("inner_a", "%ia", "S", 1),
              ...trackStruct("inner_b", "%ib", "S", 1),
              // `break` site: unwind inner then outer.
              { kind: "mark_scope_exit", scopeId: 1 },
              { kind: "mark_scope_exit", scopeId: 0 },
            ],
            { kind: "jump", target: "loop.end" }
          ),
          block("loop.end", []),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%oa", struct),
      alloc("%ob", struct),
      alloc("%ia", struct),
      alloc("%ib", struct),
      // Inner scope: reverse declaration → ib, ia.
      { kind: "destroy", value: "%ib", structName: "S" },
      { kind: "destroy", value: "%ia", structName: "S" },
      // Outer scope: reverse declaration → ob, oa.
      { kind: "destroy", value: "%ob", structName: "S" },
      { kind: "destroy", value: "%oa", structName: "S" },
    ]);
  });

  test("mark_track in an if-arm names the innermost scope_id", () => {
    // Sketch of `if (cond) { let x = ...; }`: the lowering picks up a
    // fresh inner scope id for the arm, and the `mark_track` inside it
    // points at that id. The outer scope's exit destroys nothing
    // because the var is not registered there.
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([
      [0, emptySkips()],
      [1, emptySkips()],
    ]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [{ kind: "mark_scope_enter", scopeId: 0 }], {
            kind: "br",
            cond: "%cond",
            thenBlock: "if.then",
            elseBlock: "if.end",
          }),
          block(
            "if.then",
            [
              { kind: "mark_scope_enter", scopeId: 1 },
              // Inner scope owns `x`.
              ...trackStruct("x", "%x", "S", 1),
              { kind: "mark_scope_exit", scopeId: 1 },
            ],
            { kind: "jump", target: "if.end" }
          ),
          block("if.end", [{ kind: "mark_scope_exit", scopeId: 0 }]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([]);
    expect(after.functions[0]?.blocks[1]?.instructions).toEqual([
      alloc("%x", struct),
      // Inner scope exit destroys `x`.
      { kind: "destroy", value: "%x", structName: "S" },
    ]);
    // Outer scope exit destroys nothing (`x` was registered in scope 1).
    expect(after.functions[0]?.blocks[2]?.instructions).toEqual([]);
  });

  test("mark_scope_enter and mark_track do not survive the rewrite", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, emptySkips()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            { kind: "mark_scope_enter", scopeId: 0 },
            ...trackStruct("x", "%x", "S", 0),
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    const kinds = allKinds(after);
    expect(kinds).not.toContain("mark_scope_enter");
    expect(kinds).not.toContain("mark_scope_exit");
    expect(kinds).not.toContain("mark_track");
  });

  test("tracked-vars set follows the marker stream across blocks", () => {
    // `mark_track` in block A, `mark_scope_exit` in block B: the pass
    // walks the whole function pre-rewrite so the cross-block link
    // resolves correctly.
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, emptySkips()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block(
            "entry",
            [{ kind: "mark_scope_enter", scopeId: 0 }, ...trackStruct("x", "%x", "S", 0)],
            { kind: "jump", target: "exit" }
          ),
          block("exit", [{ kind: "mark_scope_exit", scopeId: 0 }]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([alloc("%x", struct)]);
    expect(after.functions[0]?.blocks[1]?.instructions).toEqual([
      { kind: "destroy", value: "%x", structName: "S" },
    ]);
  });
});
