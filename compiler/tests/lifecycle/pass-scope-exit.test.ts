/**
 * Lifecycle pass — `mark_scope_exit` rewrite (PR 4a, updated PR 4e).
 *
 * Per `docs/design/lifecycle-module.md` §9, these tests exercise the
 * `mark_scope_exit` → destroy-sequence rewrite on synthetic KIR (no
 * parser, no checker, no lowering driver). After PR 4e the tracked
 * vars are sourced from `mark_track` markers in the same function;
 * the `skipNames` set still comes from the transitional
 * `lifecycleScopeExits` side-table until PR 4d migrates `mark_moved`.
 *
 * Cases:
 *
 *   1. one managed-struct var → single `destroy` emitted in place of the
 *      marker
 *   2. multiple managed vars in one scope → destroys emitted in reverse
 *      declaration order
 *   3. moved-out var → skipped in the destroy sequence; the remaining
 *      vars still emit in reverse declaration order
 *   4. string var → rewrites to `call_extern_void("kei_string_destroy")`,
 *      not a plain `destroy`
 *   5. mixed scope (struct + string) → struct uses `destroy`, string uses
 *      the extern call, both ordered correctly relative to declaration
 *   6. empty scope → marker stripped, no destroys emitted
 *   7. no `mark_track` for the scope → marker stripped without rewrite
 *      (defensive: missing data must not produce stray destroys)
 *   8. multiple scopes in one function (nested) → each marker rewrites
 *      against its own scope-id key independently
 *   9. defer block lowered before the marker → destroys appear *after*
 *      the defer instructions (positional invariant from design §5)
 *  10. side-table is consumed: the rewritten function has no
 *      `lifecycleScopeExits` field (so it can't leak downstream)
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

/** A `getDecision` that always returns "no decision" — the scope-exit rewrite doesn't consult it. */
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

/** Helper: string stack-alloc + `mark_track`. */
function trackString(name: string, varId: VarId, scopeId: ScopeId): KirInst[] {
  return [alloc(varId, { kind: "string" }), { kind: "mark_track", varId, name, scopeId }];
}

/** Helper: build a scope-exit info with the given skip-names. */
function skipInfo(...skipNames: string[]): KirScopeExitInfo {
  return { skipNames: new Set(skipNames) };
}

describe("runLifecyclePass — mark_scope_exit rewrite", () => {
  test("single managed-struct var → one `destroy` in place of the marker", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("x", "%x", "Bag", 0),
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    // The `stack_alloc` survives the rewrite (it's plain KIR); only the
    // markers were stripped/rewritten.
    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%x", { kind: "struct", name: "Bag", fields: [] }),
      { kind: "destroy", value: "%x", structName: "Bag" },
    ]);
  });

  test("multiple vars in one scope → destroys in reverse declaration order", () => {
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("a", "%a", "S", 0),
            ...trackStruct("b", "%b", "S", 0),
            ...trackStruct("c", "%c", "S", 0),
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
      alloc("%c", struct),
      { kind: "destroy", value: "%c", structName: "S" },
      { kind: "destroy", value: "%b", structName: "S" },
      { kind: "destroy", value: "%a", structName: "S" },
    ]);
  });

  test("moved-out var → skipped; remaining vars still fire in reverse order", () => {
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo("b")]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("a", "%a", "S", 0),
            ...trackStruct("b", "%b", "S", 0),
            ...trackStruct("c", "%c", "S", 0),
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
      alloc("%c", struct),
      { kind: "destroy", value: "%c", structName: "S" },
      { kind: "destroy", value: "%a", structName: "S" },
    ]);
  });

  test("string var → `kei_string_destroy` extern call, not generic destroy", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn(
        "f",
        [block("entry", [...trackString("s", "%s", 0), { kind: "mark_scope_exit", scopeId: 0 }])],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%s", { kind: "string" }),
      { kind: "call_extern_void", func: "kei_string_destroy", args: ["%s"] },
    ]);
  });

  test("mixed struct + string in one scope → correct dispatch and order", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("buf", "%buf", "Buffer", 0),
            ...trackString("label", "%label", 0),
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%buf", { kind: "struct", name: "Buffer", fields: [] }),
      alloc("%label", { kind: "string" }),
      // Reverse declaration: label first, then buf.
      { kind: "call_extern_void", func: "kei_string_destroy", args: ["%label"] },
      { kind: "destroy", value: "%buf", structName: "Buffer" },
    ]);
  });

  test("empty scope → marker stripped, no destroys emitted", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn("f", [block("entry", [{ kind: "mark_scope_exit", scopeId: 0 }])], scopeExits)
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([]);
  });

  test("no `mark_track` for the scope → marker stripped without rewriting", () => {
    // A `mark_scope_exit` whose scope id was never named by a
    // `mark_track` must be dropped without emitting stray destroys.
    const before = moduleWith(fn("f", [block("entry", [{ kind: "mark_scope_exit", scopeId: 0 }])]));
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([]);
  });

  test("multiple scopes in one function → each marker rewrites against its own id", () => {
    const struct: KirType = { kind: "struct", name: "S", fields: [] };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([
      [0, skipInfo()],
      [1, skipInfo()],
    ]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("outer", "%outer", "S", 0),
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
      { kind: "destroy", value: "%inner", structName: "S" },
      { kind: "destroy", value: "%outer", structName: "S" },
    ]);
  });

  test("defer instructions before the marker stay before the destroys", () => {
    // Per design doc §5 / spec resolution of #38, lowering positions
    // defer-block KIR before `mark_scope_exit`. The pass appends
    // destroys after the marker's original position — so user defer
    // code runs *before* compiler-emitted destroys.
    const deferInst: KirInst = {
      kind: "call_extern_void",
      func: "user_defer_body",
      args: [],
    };
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn(
        "f",
        [
          block("entry", [
            ...trackStruct("x", "%x", "Bag", 0),
            deferInst,
            { kind: "mark_scope_exit", scopeId: 0 },
          ]),
        ],
        scopeExits
      )
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.blocks[0]?.instructions).toEqual([
      alloc("%x", { kind: "struct", name: "Bag", fields: [] }),
      deferInst,
      { kind: "destroy", value: "%x", structName: "Bag" },
    ]);
  });

  test("rewritten function carries no `lifecycleScopeExits` field downstream", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn("f", [block("entry", [{ kind: "mark_scope_exit", scopeId: 0 }])], scopeExits)
    );
    const after = runLifecyclePass(before, noDecisions);

    expect(after.functions[0]?.lifecycleScopeExits).toBeUndefined();
  });

  test("does not mutate the input module's side-table", () => {
    const scopeExits = new Map<ScopeId, KirScopeExitInfo>([[0, skipInfo()]]);
    const before = moduleWith(
      fn("f", [block("entry", [{ kind: "mark_scope_exit", scopeId: 0 }])], scopeExits)
    );

    runLifecyclePass(before, noDecisions);

    expect(scopeExits.size).toBe(1);
    expect(before.functions[0]?.lifecycleScopeExits).toBe(scopeExits);
  });
});
