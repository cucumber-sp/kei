/**
 * Lifecycle.decide — table-driven unit tests.
 *
 * These tests exercise the decide sub-concern in isolation: register a
 * synthetic set of `StructType`s, run the fixed point, and assert what
 * decisions came out.  No checker, no parser — the StructType graph is
 * built by hand so each test case targets exactly one decision pattern.
 *
 * Cases (per `docs/design/lifecycle-module.md` §10 ("Decide tests")):
 *   1. struct with no managed fields → no decision
 *   2. struct with one string field → decision with destroy carrying
 *      that field
 *   3. struct with nested managed struct → decision picks up
 *      transitively (fixed-point case)
 *   4. struct with explicit user `__destroy` → no auto-decision (user wins)
 *   5. mutually-recursive managed struct fields converge in a bounded
 *      number of fixed-point iterations
 */

import { describe, expect, test } from "bun:test";
import type { FunctionType, StructType, Type } from "../../src/checker/types";
import { functionType, STRING_TYPE, TypeKind, VOID_TYPE } from "../../src/checker/types";
import { createLifecycle } from "../../src/lifecycle";

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

/** Mirror callback used by struct-checker's transition shim — for testing
 * that the Lifecycle module fires it for each newly-decided arm. */
function mirrorOnto(struct: StructType, arm: "destroy" | "oncopy"): void {
  if (arm === "destroy") {
    struct.methods.set(
      "__destroy",
      functionType([{ name: "self", type: struct, isReadonly: false }], VOID_TYPE, [], [], false)
    );
    struct.autoDestroy = true;
  } else {
    struct.methods.set(
      "__oncopy",
      functionType([{ name: "self", type: struct, isReadonly: false }], struct, [], [], false)
    );
    struct.autoOncopy = true;
  }
}

describe("Lifecycle.decide — fixed-point", () => {
  test("struct with no managed fields → no decision", () => {
    const lc = createLifecycle();
    const point = makeStruct("Point", [
      ["x", { kind: TypeKind.Float, bits: 64 }],
      ["y", { kind: TypeKind.Float, bits: 64 }],
    ]);
    lc.register(point);
    lc.runFixedPoint();

    expect(lc.getDecision(point)).toBeUndefined();
    expect(lc.hasDestroy(point)).toBe(false);
    expect(lc.hasOncopy(point)).toBe(false);
  });

  test("struct with one string field → destroy + oncopy decision carrying that field", () => {
    const lc = createLifecycle();
    const greeting = makeStruct("Greeting", [["text", STRING_TYPE]]);
    lc.register(greeting);
    lc.runFixedPoint(mirrorOnto);

    const decision = lc.getDecision(greeting);
    expect(decision).toBeDefined();
    expect(decision?.destroy?.fields).toEqual([{ name: "text" }]);
    // String fields also need the copy hook (deep-copy semantics).
    expect(decision?.oncopy?.fields).toEqual([{ name: "text" }]);
    expect(lc.hasDestroy(greeting)).toBe(true);
    expect(lc.hasOncopy(greeting)).toBe(true);
  });

  test("nested managed struct → decision picks up transitively (fixed point)", () => {
    const lc = createLifecycle();
    const inner = makeStruct("Inner", [["text", STRING_TYPE]]);
    // The outer struct has only an `Inner` field; whether it needs
    // destroy depends on whether `Inner` does.  Register both and run
    // the fixed point.
    const outer = makeStruct("Outer", [["bag", inner]]);
    lc.register(inner);
    lc.register(outer);
    lc.runFixedPoint(mirrorOnto);

    expect(lc.hasDestroy(inner)).toBe(true);
    expect(lc.hasDestroy(outer)).toBe(true);
    expect(lc.getDecision(outer)?.destroy?.fields).toEqual([{ name: "bag" }]);
  });

  test("explicit user `__destroy` → no auto-decision (user wins)", () => {
    const lc = createLifecycle();
    const explicit = makeStruct("Explicit", [["text", STRING_TYPE]]);
    // Pre-populate a user-written __destroy.
    const userDestroy: FunctionType = functionType(
      [{ name: "self", type: explicit, isReadonly: false }],
      VOID_TYPE,
      [],
      [],
      false
    );
    explicit.methods.set("__destroy", userDestroy);

    lc.register(explicit);
    lc.runFixedPoint(mirrorOnto);

    // No auto-decision for destroy — user provided it.  oncopy is
    // still missing, so the module decides on it.
    const decision = lc.getDecision(explicit);
    expect(decision?.destroy).toBeUndefined();
    expect(lc.hasDestroy(explicit)).toBe(false);
    // The user-written __destroy still satisfies fieldNeedsOncopy via
    // the transitive rule for nested structs that *contain* this
    // explicit one — but for the explicit struct itself, the absence
    // of an __oncopy on its own type means the module synthesises one
    // because of its string field.
    expect(decision?.oncopy?.fields).toEqual([{ name: "text" }]);
  });

  test("mutually-recursive managed-by-pointer fields converge in bounded iterations", () => {
    // Mutual recursion in this language goes through pointers (a struct
    // can't directly contain a value-typed field of itself or of
    // another struct that contains it — that would be infinite size).
    // Pointers are not managed fields, so the lifecycle decision for
    // such a graph is the same as for a struct without those fields.
    //
    // To exercise the fixed point's convergence on a chain that *does*
    // ripple, we use a four-link chain D → C → B → A where A holds a
    // string. The decision for D depends on C, C on B, B on A; only
    // after A is decided in iteration 1 does B flip in iteration 2,
    // C in iteration 3, D in iteration 4.  All four flip within
    // |structs| iterations — the termination bound from
    // `docs/design/lifecycle-module.md` (decide.ts module docstring).
    const lc = createLifecycle();
    const a = makeStruct("A", [["text", STRING_TYPE]]);
    const b = makeStruct("B", [["a", a]]);
    const c = makeStruct("C", [["b", b]]);
    const d = makeStruct("D", [["c", c]]);

    // Register in *reverse* dependency order — the worst case for the
    // iteration, since each pass through the list flips at most one
    // struct.
    lc.register(d);
    lc.register(c);
    lc.register(b);
    lc.register(a);

    lc.runFixedPoint(mirrorOnto);

    expect(lc.hasDestroy(a)).toBe(true);
    expect(lc.hasDestroy(b)).toBe(true);
    expect(lc.hasDestroy(c)).toBe(true);
    expect(lc.hasDestroy(d)).toBe(true);
    expect(lc.getDecision(d)?.destroy?.fields).toEqual([{ name: "c" }]);
  });

  test("generic struct templates are skipped (handled at monomorphization time)", () => {
    const lc = createLifecycle();
    const generic: StructType = {
      ...makeStruct("Box"),
      genericParams: ["T"],
      fields: new Map([["text", STRING_TYPE]]),
    };
    lc.register(generic);
    lc.runFixedPoint(mirrorOnto);

    // Even though the field would normally trigger a decision, generics
    // are skipped — the concrete instantiation `Box<i32>` is registered
    // separately by monomorphization and decided then.
    expect(lc.getDecision(generic)).toBeUndefined();
  });

  test("register is idempotent — same struct registered twice produces one decision", () => {
    const lc = createLifecycle();
    const s = makeStruct("S", [["text", STRING_TYPE]]);
    lc.register(s);
    lc.register(s);

    let arms = 0;
    lc.runFixedPoint(() => arms++);

    // Two arms (destroy + oncopy) for a struct with a single string
    // field — not four.
    expect(arms).toBe(2);
  });
});
