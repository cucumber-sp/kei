/**
 * Lifecycle pass — `mark_assign` rewrite (PR 4b).
 *
 * Table-driven tests on synthetic KIR: each case constructs a single
 * `mark_assign` against a slot whose pointee type is set by surrounding
 * `stack_alloc` / `field_ptr` / `index_ptr` instructions, runs the
 * Lifecycle pass, and asserts the emitted sequence.
 *
 * Cases per `docs/design/lifecycle-module.md` §9:
 *   1. non-managed slot                → bare `store`
 *   2. managed-struct slot, non-move RHS → load / destroy / store / oncopy
 *   3. managed-struct slot, move RHS    → load / destroy / store (no oncopy)
 *   4. string slot                      → `kei_string_destroy` / store
 *   5. managed-field slot via `field_ptr` → same as (2), reached through
 *      a struct field
 *   6. managed-struct with `destroy` but no `oncopy`             → load / destroy / store
 *   7. managed-struct with `oncopy` but no `destroy`             → store / oncopy
 *   8. unknown slot type (no producing instruction)              → bare `store`
 *
 * The struct's lifecycle arms are encoded as no-body `__destroy` /
 * `__oncopy` KirFunctions in the module — the pass derives "has destroy
 * hook?" / "has oncopy hook?" by scanning function names, which matches
 * how both auto-generated and user-written hooks land in real KIR.
 */

import { describe, expect, test } from "bun:test";
import type { KirBlock, KirFunction, KirInst, KirModule, KirType } from "../../src/kir/kir-types";
import { runLifecyclePass } from "../../src/lifecycle";

const noDecisions = () => undefined;

const I32: KirType = { kind: "int", bits: 32, signed: true };
const STR: KirType = { kind: "string" };
const VOID: KirType = { kind: "void" };

function structType(name: string): KirType {
  return { kind: "struct", name, fields: [] };
}

function block(id: string, instructions: KirInst[]): KirBlock {
  return { id, phis: [], instructions, terminator: { kind: "ret_void" } };
}

function fn(name: string, instructions: KirInst[], localCount = 0): KirFunction {
  return {
    name,
    params: [],
    returnType: VOID,
    blocks: [block("entry", instructions)],
    localCount,
  };
}

/** No-body destroy/oncopy stub. The pass only checks the name; the body is irrelevant. */
function lifecycleStub(name: string): KirFunction {
  return {
    name,
    params: [{ name: "self", type: { kind: "ptr", pointee: structType("placeholder") } }],
    returnType: VOID,
    blocks: [block("entry", [])],
    localCount: 0,
  };
}

function moduleWith(fns: KirFunction[]): KirModule {
  return { name: "test", globals: [], functions: fns, types: [], externs: [] };
}

/** Pluck the entry-block instructions of `fnName` from the rewritten module. */
function entryInsts(module: KirModule, fnName: string): KirInst[] {
  const f = module.functions.find((x) => x.name === fnName);
  if (!f) throw new Error(`missing function ${fnName}`);
  const b = f.blocks[0];
  if (!b) throw new Error(`function ${fnName} has no entry block`);
  return b.instructions;
}

describe("Lifecycle pass — mark_assign rewrite (PR 4b)", () => {
  test("non-managed slot → bare store", () => {
    // `let x = 1; x = 2;` style — slot is `*i32`.
    const before = moduleWith([
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: I32 },
          { kind: "const_int", dest: "%v", type: I32, value: 7 },
          { kind: "mark_assign", slot: "%slot", newValue: "%v", isMove: false },
        ],
        2
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: I32 },
      { kind: "const_int", dest: "%v", type: I32, value: 7 },
      { kind: "store", ptr: "%slot", value: "%v" },
    ]);
  });

  test("managed-struct slot, non-move RHS → load / destroy / store / oncopy", () => {
    const Bag = structType("Bag");
    const before = moduleWith([
      lifecycleStub("Bag___destroy"),
      lifecycleStub("Bag___oncopy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: Bag },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: Bag },
      { kind: "load", dest: "%1", ptr: "%slot", type: Bag },
      { kind: "destroy", value: "%1", structName: "Bag" },
      { kind: "store", ptr: "%slot", value: "%new" },
      { kind: "oncopy", value: "%new", structName: "Bag" },
    ]);
  });

  test("managed-struct slot, move RHS → load / destroy / store (no oncopy)", () => {
    const Bag = structType("Bag");
    const before = moduleWith([
      lifecycleStub("Bag___destroy"),
      lifecycleStub("Bag___oncopy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: Bag },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: true },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: Bag },
      { kind: "load", dest: "%1", ptr: "%slot", type: Bag },
      { kind: "destroy", value: "%1", structName: "Bag" },
      { kind: "store", ptr: "%slot", value: "%new" },
    ]);
  });

  test("string slot → kei_string_destroy then store", () => {
    const before = moduleWith([
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: STR },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: STR },
      { kind: "call_extern_void", func: "kei_string_destroy", args: ["%slot"] },
      { kind: "store", ptr: "%slot", value: "%new" },
    ]);
  });

  test("string slot, isMove still emits destroy (isMove only suppresses oncopy)", () => {
    // The `is_move` bit on `mark_assign` only controls the trailing oncopy.
    // The old-value destroy fires regardless — even when moving, the slot's
    // previous contents must be cleaned up.
    const before = moduleWith([
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: STR },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: true },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: STR },
      { kind: "call_extern_void", func: "kei_string_destroy", args: ["%slot"] },
      { kind: "store", ptr: "%slot", value: "%new" },
    ]);
  });

  test("managed field via field_ptr → load / destroy / store / oncopy", () => {
    const Outer = structType("Outer");
    const Inner = structType("Inner");
    const before = moduleWith([
      lifecycleStub("Inner___destroy"),
      lifecycleStub("Inner___oncopy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%outer", type: Outer },
          { kind: "field_ptr", dest: "%slot", base: "%outer", field: "inner", type: Inner },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        2
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%outer", type: Outer },
      { kind: "field_ptr", dest: "%slot", base: "%outer", field: "inner", type: Inner },
      { kind: "load", dest: "%2", ptr: "%slot", type: Inner },
      { kind: "destroy", value: "%2", structName: "Inner" },
      { kind: "store", ptr: "%slot", value: "%new" },
      { kind: "oncopy", value: "%new", structName: "Inner" },
    ]);
  });

  test("managed element via index_ptr → load / destroy / store / oncopy", () => {
    const Bag = structType("Bag");
    const before = moduleWith([
      lifecycleStub("Bag___destroy"),
      lifecycleStub("Bag___oncopy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%arr", type: { kind: "array", element: Bag, length: 4 } },
          { kind: "const_int", dest: "%i", type: I32, value: 0 },
          { kind: "index_ptr", dest: "%slot", base: "%arr", index: "%i", type: Bag },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        3
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    // Pre-marker instructions pass through; rewrite emits the lifecycle sequence.
    const insts = entryInsts(after, "f");
    expect(insts.slice(-4)).toEqual([
      { kind: "load", dest: "%3", ptr: "%slot", type: Bag },
      { kind: "destroy", value: "%3", structName: "Bag" },
      { kind: "store", ptr: "%slot", value: "%new" },
      { kind: "oncopy", value: "%new", structName: "Bag" },
    ]);
  });

  test("struct with __destroy but no __oncopy → load / destroy / store", () => {
    const Box = structType("Box");
    const before = moduleWith([
      lifecycleStub("Box___destroy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: Box },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: Box },
      { kind: "load", dest: "%1", ptr: "%slot", type: Box },
      { kind: "destroy", value: "%1", structName: "Box" },
      { kind: "store", ptr: "%slot", value: "%new" },
    ]);
  });

  test("struct with __oncopy but no __destroy → store / oncopy", () => {
    const Tag = structType("Tag");
    const before = moduleWith([
      lifecycleStub("Tag___oncopy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%slot", type: Tag },
          { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
        ],
        1
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([
      { kind: "stack_alloc", dest: "%slot", type: Tag },
      { kind: "store", ptr: "%slot", value: "%new" },
      { kind: "oncopy", value: "%new", structName: "Tag" },
    ]);
  });

  test("unknown slot (no producing instruction) → bare store", () => {
    // Defensive fallback — a slot the pass can't type-resolve should never
    // produce a destroy. Real lowering always emits a producing instruction
    // before the marker; this case guards against the marker meaning
    // "destroy unconditionally."
    const before = moduleWith([
      fn("f", [{ kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false }], 0),
    ]);

    const after = runLifecyclePass(before, noDecisions);

    expect(entryInsts(after, "f")).toEqual([{ kind: "store", ptr: "%slot", value: "%new" }]);
  });

  test("isMove suppresses oncopy on managed struct", () => {
    // Direct table-driven check: with both arms present, isMove flips
    // exactly the oncopy emission. The destroy and store stay.
    const Bag = structType("Bag");
    const makeMod = (isMove: boolean) =>
      moduleWith([
        lifecycleStub("Bag___destroy"),
        lifecycleStub("Bag___oncopy"),
        fn(
          "f",
          [
            { kind: "stack_alloc", dest: "%slot", type: Bag },
            { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove },
          ],
          1
        ),
      ]);

    const noMove = entryInsts(runLifecyclePass(makeMod(false), noDecisions), "f");
    const move = entryInsts(runLifecyclePass(makeMod(true), noDecisions), "f");

    expect(noMove.map((i) => i.kind)).toEqual([
      "stack_alloc",
      "load",
      "destroy",
      "store",
      "oncopy",
    ]);
    expect(move.map((i) => i.kind)).toEqual(["stack_alloc", "load", "destroy", "store"]);
  });

  test("fresh load destinations don't collide with existing locals", () => {
    // localCount=3 means %0, %1, %2 are taken; the rewriter must mint
    // %3 (or higher), never reuse one of those.
    const Bag = structType("Bag");
    const before = moduleWith([
      lifecycleStub("Bag___destroy"),
      fn(
        "f",
        [
          { kind: "stack_alloc", dest: "%0", type: Bag },
          { kind: "stack_alloc", dest: "%1", type: I32 },
          { kind: "stack_alloc", dest: "%2", type: I32 },
          { kind: "mark_assign", slot: "%0", newValue: "%v", isMove: false },
        ],
        3
      ),
    ]);

    const after = runLifecyclePass(before, noDecisions);
    const insts = entryInsts(after, "f");
    const load = insts.find((i) => i.kind === "load");
    if (load?.kind !== "load") throw new Error("expected load instruction");
    expect(["%0", "%1", "%2"]).not.toContain(load.dest);
  });

  test("does not mutate the input module", () => {
    const Bag = structType("Bag");
    const original: KirInst[] = [
      { kind: "stack_alloc", dest: "%slot", type: Bag },
      { kind: "mark_assign", slot: "%slot", newValue: "%new", isMove: false },
    ];
    const beforeBlock = block("entry", original);
    const before = moduleWith([
      lifecycleStub("Bag___destroy"),
      lifecycleStub("Bag___oncopy"),
      {
        name: "f",
        params: [],
        returnType: VOID,
        blocks: [beforeBlock],
        localCount: 1,
      },
    ]);

    runLifecyclePass(before, noDecisions);

    expect(beforeBlock.instructions).toEqual(original);
  });
});
