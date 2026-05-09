/**
 * Lifecycle.synthesise — table-driven snapshot tests.
 *
 * These tests exercise the synthesise sub-concern in isolation: build a
 * synthetic `StructType` plus a synthetic {@link LifecycleDecision},
 * call `synthesise(struct, decision)`, and assert on the produced
 * `KirFunction[]`.  No checker, no parser, no lowering driver — the
 * pure-function shape is what makes this seam testable.
 *
 * Cases (per `docs/design/lifecycle-module.md` §9 ("Synthesise tests")):
 *   1. struct with one string field → `__destroy` body that destroys
 *      that field; no `__oncopy` (when only the destroy arm is decided)
 *   2. struct with one string field marked managed-on-copy → `__oncopy`
 *      body that re-copies the field
 *   3. struct with multiple managed fields → fields appear in
 *      reverse declaration order in `__destroy`
 *   4. struct with mixed managed + plain fields → only managed fields
 *      appear in the body
 *   5. struct with a nested managed struct field → body destroys via
 *      the nested struct's `__destroy`, not by inlining
 *   6. empty decision (no managed fields) → empty `KirFunction[]`
 */

import { describe, expect, test } from "bun:test";
import type { StructType, Type } from "../../src/checker/types";
import { functionType, STRING_TYPE, TypeKind, VOID_TYPE } from "../../src/checker/types";
import type { KirFieldPtr, KirFunction } from "../../src/kir/kir-types";
import type { LifecycleDecision } from "../../src/lifecycle";
import { synthesise } from "../../src/lifecycle";

/** Build a bare StructType — fields/methods can be mutated by the caller. */
function makeStruct(name: string, fields: Array<[string, Type]> = []): StructType {
  return {
    kind: TypeKind.Struct,
    name,
    fields: new Map(fields),
    methods: new Map(),
    isUnsafe: false,
    genericParams: [],
  };
}

/**
 * Mark `nested` as having a user-supplied (or already-decided) destroy
 * hook — synthesise reads `methods.has("__destroy")` to know it should
 * recurse into the nested struct rather than inline anything.
 */
function withDestroyHook(struct: StructType): StructType {
  struct.methods.set(
    "__destroy",
    functionType([{ name: "self", type: struct, isReadonly: false }], VOID_TYPE, [], [], false)
  );
  return struct;
}

function withOncopyHook(struct: StructType): StructType {
  struct.methods.set(
    "__oncopy",
    functionType([{ name: "self", type: struct, isReadonly: false }], struct, [], [], false)
  );
  return struct;
}

/** Locate the `__destroy` / `__oncopy` function in the synthesised array. */
function findArm(fns: KirFunction[], suffix: "___destroy" | "___oncopy"): KirFunction | undefined {
  return fns.find((f) => f.name.endsWith(suffix));
}

/** All `field_ptr` instructions in the function body's entry block, in order. */
function fieldPtrs(fn: KirFunction): KirFieldPtr[] {
  const entry = fn.blocks[0];
  if (!entry) return [];
  return entry.instructions.filter((i): i is KirFieldPtr => i.kind === "field_ptr");
}

describe("Lifecycle.synthesise — table-driven", () => {
  test("single string field, destroy-only decision → __destroy body, no __oncopy", () => {
    const struct = makeStruct("Greeting", [["text", STRING_TYPE]]);
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "text" }] } };

    const fns = synthesise(struct, decision);

    expect(fns.length).toBe(1);
    const destroy = findArm(fns, "___destroy");
    expect(destroy).toBeDefined();
    expect(destroy?.name).toBe("Greeting___destroy");
    // Body destroys the `text` field via kei_string_destroy.
    const insts = destroy!.blocks[0]!.instructions;
    expect(insts).toEqual([
      {
        kind: "field_ptr",
        dest: "%_v0",
        base: "%self",
        field: "text",
        type: { kind: "string" },
      },
      { kind: "call_extern_void", func: "kei_string_destroy", args: ["%_v0"] },
    ]);
    expect(findArm(fns, "___oncopy")).toBeUndefined();
  });

  test("single string field marked managed-on-copy → __oncopy body re-copies the field", () => {
    const struct = makeStruct("Greeting", [["text", STRING_TYPE]]);
    const decision: LifecycleDecision = { oncopy: { fields: [{ name: "text" }] } };

    const fns = synthesise(struct, decision);

    expect(fns.length).toBe(1);
    const oncopy = findArm(fns, "___oncopy");
    expect(oncopy).toBeDefined();
    expect(oncopy?.name).toBe("Greeting___oncopy");
    const insts = oncopy!.blocks[0]!.instructions;
    // field_ptr → load → kei_string_copy → store back
    expect(insts).toEqual([
      {
        kind: "field_ptr",
        dest: "%_v0",
        base: "%self",
        field: "text",
        type: { kind: "string" },
      },
      { kind: "load", dest: "%_v1", ptr: "%_v0", type: { kind: "string" } },
      {
        kind: "call_extern",
        dest: "%_v2",
        func: "kei_string_copy",
        args: ["%_v1"],
        type: { kind: "string" },
      },
      { kind: "store", ptr: "%_v0", value: "%_v2" },
    ]);
  });

  test("multiple managed fields → __destroy walks them in reverse declaration order", () => {
    // Three string fields declared a, b, c; spec §6.9 says destroy
    // walks them c, b, a.
    const struct = makeStruct("Triple", [
      ["a", STRING_TYPE],
      ["b", STRING_TYPE],
      ["c", STRING_TYPE],
    ]);
    const decision: LifecycleDecision = {
      destroy: { fields: [{ name: "a" }, { name: "b" }, { name: "c" }] },
    };

    const fns = synthesise(struct, decision);

    const destroy = findArm(fns, "___destroy")!;
    const ptrs = fieldPtrs(destroy);
    expect(ptrs.map((p) => p.field)).toEqual(["c", "b", "a"]);
  });

  test("mixed managed + plain fields → only managed fields appear in the body", () => {
    // Plain fields (i32, f64) are not in the decision; synthesise must
    // not emit field_ptrs for them.
    const struct = makeStruct("Mixed", [
      ["counter", { kind: TypeKind.Int, bits: 32, signed: true } as Type],
      ["name", STRING_TYPE],
      ["weight", { kind: TypeKind.Float, bits: 64 } as Type],
    ]);
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "name" }] } };

    const fns = synthesise(struct, decision);

    const destroy = findArm(fns, "___destroy")!;
    const ptrs = fieldPtrs(destroy);
    // Only `name` — counter/weight are plain.
    expect(ptrs.map((p) => p.field)).toEqual(["name"]);
  });

  test("nested managed struct → __destroy recurses via the nested struct's hook, not inlined", () => {
    const inner = withDestroyHook(makeStruct("Inner", [["text", STRING_TYPE]]));
    const outer = makeStruct("Outer", [["bag", inner]]);
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "bag" }] } };

    const fns = synthesise(outer, decision);

    const destroy = findArm(fns, "___destroy")!;
    const insts = destroy.blocks[0]!.instructions;
    // The body must take field_ptr to `bag` and emit a `destroy` op on
    // it — *not* inline the nested struct's body.  No `kei_string_destroy`
    // should appear (that's Inner's job, called via the destroy op).
    expect(insts).toEqual([
      {
        kind: "field_ptr",
        dest: "%_v0",
        base: "%self",
        field: "bag",
        type: { kind: "struct", name: "Inner", fields: [] },
      },
      { kind: "destroy", value: "%_v0", structName: "Inner" },
    ]);
  });

  test("nested managed struct on oncopy → recurses via nested __oncopy", () => {
    const inner = withOncopyHook(makeStruct("Inner", [["text", STRING_TYPE]]));
    const outer = makeStruct("Outer", [["bag", inner]]);
    const decision: LifecycleDecision = { oncopy: { fields: [{ name: "bag" }] } };

    const fns = synthesise(outer, decision);

    const oncopy = findArm(fns, "___oncopy")!;
    const insts = oncopy.blocks[0]!.instructions;
    // load → oncopy op → store back.  Mutation propagates through the
    // pointer; the load/store pair makes that explicit at the field
    // slot.
    expect(insts).toEqual([
      {
        kind: "field_ptr",
        dest: "%_v0",
        base: "%self",
        field: "bag",
        type: { kind: "struct", name: "Inner", fields: [] },
      },
      {
        kind: "load",
        dest: "%_v1",
        ptr: "%_v0",
        type: { kind: "struct", name: "Inner", fields: [] },
      },
      { kind: "oncopy", value: "%_v1", structName: "Inner" },
      { kind: "store", ptr: "%_v0", value: "%_v1" },
    ]);
  });

  test("empty decision (no arms) → empty KirFunction[]", () => {
    const struct = makeStruct("Empty", [["text", STRING_TYPE]]);
    const decision: LifecycleDecision = {};

    const fns = synthesise(struct, decision);

    expect(fns).toEqual([]);
  });

  test("nested struct with no destroy method is skipped (decision out of sync)", () => {
    // If the decision claims a struct field is managed but the field
    // type has no __destroy method, synthesise must produce nothing for
    // that field — the decision is the source of intent, but the field
    // needs an actual hook to call.  Defends against stale decisions
    // surviving across edits.
    const inner = makeStruct("Inner", [["text", STRING_TYPE]]); // no __destroy method
    const outer = makeStruct("Outer", [["bag", inner]]);
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "bag" }] } };

    const fns = synthesise(outer, decision);

    const destroy = findArm(fns, "___destroy")!;
    expect(destroy.blocks[0]!.instructions).toEqual([]);
  });

  test("modulePrefix is reflected in the synthesised function name", () => {
    const struct: StructType = {
      ...makeStruct("Greeting", [["text", STRING_TYPE]]),
      modulePrefix: "mymod",
    };
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "text" }] } };

    const fns = synthesise(struct, decision);

    expect(fns[0]?.name).toBe("mymod_Greeting___destroy");
  });

  test("nested managed struct's modulePrefix propagates into destroy structName", () => {
    const inner: StructType = {
      ...withDestroyHook(makeStruct("Inner", [["text", STRING_TYPE]])),
      modulePrefix: "lib",
    };
    const outer = makeStruct("Outer", [["bag", inner]]);
    const decision: LifecycleDecision = { destroy: { fields: [{ name: "bag" }] } };

    const fns = synthesise(outer, decision);

    const destroyInst = fns[0]!.blocks[0]!.instructions.find((i) => i.kind === "destroy");
    expect(destroyInst).toBeDefined();
    if (destroyInst?.kind === "destroy") {
      expect(destroyInst.structName).toBe("lib_Inner");
    }
  });
});
