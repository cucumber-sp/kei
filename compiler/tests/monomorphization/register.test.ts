/**
 * Monomorphization.register* — table-driven unit tests.
 *
 * These tests exercise the discovery sub-concern in isolation: construct
 * a fresh `Monomorphization`, hand it a synthetic instantiation record
 * (struct, function, or enum), and assert the appropriate read-side
 * accessor returns it. No checker, no parser — the records are
 * hand-rolled so each case targets exactly the storage seam.
 *
 * Cases (per `docs/migrations/monomorphization/pr-2.md`):
 *   1. registerStruct populates the struct map
 *   2. registerFunction populates the function map
 *   3. registerEnum populates the enum map
 *   4. registering the same key twice replaces the entry (last write wins)
 *   5. products() returns all three categories
 */

import { describe, expect, test } from "bun:test";
import type { EnumType, FunctionType, StructType } from "../../src/checker/types";
import { TypeKind, VOID_TYPE } from "../../src/checker/types";
import type { Lifecycle, LifecycleDecision } from "../../src/lifecycle";
import { synthesise as lifecycleSynthesise } from "../../src/lifecycle";
import type { MonomorphizedFunction, MonomorphizedStruct } from "../../src/monomorphization";
import { createMonomorphization } from "../../src/monomorphization";

function makeStruct(name: string): StructType {
  return {
    kind: TypeKind.Struct,
    name,
    fields: new Map(),
    methods: new Map(),
    isUnsafe: false,
    genericParams: [],
  };
}

function makeFunctionType(): FunctionType {
  return {
    kind: TypeKind.Function,
    params: [],
    returnType: VOID_TYPE,
    throwsTypes: [],
    genericParams: [],
    isExtern: false,
  };
}

function makeEnum(name: string): EnumType {
  return {
    kind: TypeKind.Enum,
    name,
    baseType: null,
    variants: [],
    genericParams: [],
  };
}

function makeMonoStruct(genericName: string, mangledName: string): MonomorphizedStruct {
  const original = makeStruct(genericName);
  original.genericParams = ["T"];
  const concrete = makeStruct(mangledName);
  return {
    original,
    typeArgs: [{ kind: TypeKind.Int, bits: 32, signed: true }],
    concrete,
  };
}

function makeMonoFunction(originalName: string, mangledName: string): MonomorphizedFunction {
  return {
    originalName,
    typeArgs: [{ kind: TypeKind.Int, bits: 32, signed: true }],
    concrete: makeFunctionType(),
    mangledName,
  };
}

describe("Monomorphization.register", () => {
  test("registerStruct populates the struct registry", () => {
    const mono = createMonomorphization();
    const info = makeMonoStruct("Box", "Box_i32");

    mono.registerStruct("Box_i32", info);

    expect(mono.getMonomorphizedStruct("Box_i32")).toBe(info);
    expect(mono.getMonomorphizedStruct("Box_bool")).toBeUndefined();
    expect(mono.products().structs.size).toBe(1);
  });

  test("registerFunction populates the function registry", () => {
    const mono = createMonomorphization();
    const info = makeMonoFunction("identity", "identity_i32");

    mono.registerFunction("identity_i32", info);

    expect(mono.getMonomorphizedFunction("identity_i32")).toBe(info);
    expect(mono.getMonomorphizedFunction("identity_bool")).toBeUndefined();
    expect(mono.products().functions.size).toBe(1);
  });

  test("registerEnum populates the enum registry", () => {
    const mono = createMonomorphization();
    const info = makeEnum("Optional_i32");

    mono.registerEnum("Optional_i32", info);

    expect(mono.getMonomorphizedEnum("Optional_i32")).toBe(info);
    expect(mono.getMonomorphizedEnum("Optional_bool")).toBeUndefined();
    expect(mono.products().enums.size).toBe(1);
  });

  test("registering the same mangled name twice replaces the previous entry", () => {
    const mono = createMonomorphization();
    const first = makeMonoStruct("Box", "Box_i32");
    const second = makeMonoStruct("Box", "Box_i32");

    mono.registerStruct("Box_i32", first);
    mono.registerStruct("Box_i32", second);

    expect(mono.getMonomorphizedStruct("Box_i32")).toBe(second);
    expect(mono.products().structs.size).toBe(1);
  });

  test("products() exposes all three categories independently", () => {
    const mono = createMonomorphization();
    const struct = makeMonoStruct("Box", "Box_i32");
    const func = makeMonoFunction("identity", "identity_i32");
    const enm = makeEnum("Optional_i32");

    mono.registerStruct("Box_i32", struct);
    mono.registerFunction("identity_i32", func);
    mono.registerEnum("Optional_i32", enm);

    const products = mono.products();
    expect(products.structs.get("Box_i32")).toBe(struct);
    expect(products.functions.get("identity_i32")).toBe(func);
    expect(products.enums.get("Optional_i32")).toBe(enm);
  });
});

// ─── Lifecycle integration (PR 4, design doc §5) ─────────────────────────

/** A Lifecycle stub that records every `register(struct)` call. */
function makeRecordingLifecycle(): {
  lifecycle: Lifecycle;
  registered: StructType[];
} {
  const registered: StructType[] = [];
  const lifecycle: Lifecycle = {
    register(struct: StructType): void {
      registered.push(struct);
    },
    runFixedPoint(_onArmAdded?: (s: StructType, arm: "destroy" | "oncopy") => void): void {
      // no-op for these tests
    },
    hasDestroy(_struct: StructType): boolean {
      return false;
    },
    hasOncopy(_struct: StructType): boolean {
      return false;
    },
    getDecision(_struct: StructType): LifecycleDecision | undefined {
      return undefined;
    },
    synthesise: lifecycleSynthesise,
  };
  return { lifecycle, registered };
}

describe("Monomorphization × Lifecycle integration (PR 4)", () => {
  test("registerStruct calls lifecycle.register once per baked struct", () => {
    const { lifecycle, registered } = makeRecordingLifecycle();
    const mono = createMonomorphization({ lifecycle });
    const info = makeMonoStruct("Box", "Box_i32");

    mono.registerStruct("Box_i32", info);

    expect(registered).toHaveLength(1);
    expect(registered[0]).toBe(info.concrete);
  });

  test("registerStruct is idempotent under repeated mangled name (one lifecycle.register call)", () => {
    const { lifecycle, registered } = makeRecordingLifecycle();
    const mono = createMonomorphization({ lifecycle });
    const first = makeMonoStruct("Box", "Box_i32");
    const second = makeMonoStruct("Box", "Box_i32");

    mono.registerStruct("Box_i32", first);
    mono.registerStruct("Box_i32", second);

    // Only the first registration fires the hook; the second is a
    // last-write-wins update to the map but doesn't double-register
    // with Lifecycle.
    expect(registered).toHaveLength(1);
    expect(registered[0]).toBe(first.concrete);
  });

  test("registerFunction does not invoke lifecycle.register", () => {
    // Lifecycle owns destroy/oncopy decisions, which only apply to
    // structs. Function instantiations are out of scope.
    const { lifecycle, registered } = makeRecordingLifecycle();
    const mono = createMonomorphization({ lifecycle });

    mono.registerFunction("identity_i32", makeMonoFunction("identity", "identity_i32"));

    expect(registered).toHaveLength(0);
  });

  test("registerEnum does not invoke lifecycle.register", () => {
    // Same rationale as registerFunction — Lifecycle handles structs.
    const { lifecycle, registered } = makeRecordingLifecycle();
    const mono = createMonomorphization({ lifecycle });

    mono.registerEnum("Optional_i32", makeEnum("Optional_i32"));

    expect(registered).toHaveLength(0);
  });

  test("adoptStruct fires lifecycle.register when this instance didn't already hold the entry", () => {
    // Mirrors the cross-module orchestrator path: module B adopts a
    // `Foo<i32>` registered by module A, and the adopting instance's
    // Lifecycle needs to learn about the concrete struct too.
    const { lifecycle, registered } = makeRecordingLifecycle();
    const mono = createMonomorphization({ lifecycle });
    const info = makeMonoStruct("Box", "Box_i32");

    mono.adoptStruct("Box_i32", info);

    expect(registered).toHaveLength(1);
    expect(registered[0]).toBe(info.concrete);
  });

  test("creating a Monomorphization without lifecycle leaves register a no-op", () => {
    // Tests / multi-module combined views don't need lifecycle
    // integration — the per-module checkers already handled it.
    const mono = createMonomorphization();
    const info = makeMonoStruct("Box", "Box_i32");
    expect(() => mono.registerStruct("Box_i32", info)).not.toThrow();
    expect(mono.getMonomorphizedStruct("Box_i32")).toBe(info);
  });
});
