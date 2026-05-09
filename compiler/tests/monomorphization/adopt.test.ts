/**
 * Monomorphization.adopt — table-driven unit tests.
 *
 * Two `Monomorphization` instances each holding `Foo<i32>` adopt one
 * into the other. Assert no duplicates: by-mangled-name dedup keeps the
 * pre-existing entry. Mirrors the cross-module-merge behaviour the
 * multi-module orchestrator relies on (a generic struct defined in
 * module A and instantiated by both A and B should land once in A's
 * registry).
 *
 * Cases (per `docs/migrations/monomorphization/pr-2.md`):
 *   1. adopt merges new entries into the recipient
 *   2. adopting a duplicate key is idempotent — first entry wins
 *   3. per-kind adopt* methods exhibit the same dedup behaviour
 *   4. adopt() handles structs, functions, and enums in one pass
 */

import { describe, expect, test } from "bun:test";
import type { EnumType, FunctionType, StructType } from "../../src/checker/types";
import { TypeKind, VOID_TYPE } from "../../src/checker/types";
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

describe("Monomorphization.adopt", () => {
  test("adopt merges entries from `other` into the recipient", () => {
    const a = createMonomorphization();
    const b = createMonomorphization();

    const fooI32 = makeMonoStruct("Foo", "Foo_i32");
    b.registerStruct("Foo_i32", fooI32);

    a.adopt(b);

    expect(a.getMonomorphizedStruct("Foo_i32")).toBe(fooI32);
    expect(a.products().structs.size).toBe(1);
  });

  test("adopting a duplicate key keeps the existing entry (no duplicates)", () => {
    const a = createMonomorphization();
    const b = createMonomorphization();

    const original = makeMonoStruct("Foo", "Foo_i32");
    const duplicate = makeMonoStruct("Foo", "Foo_i32");

    a.registerStruct("Foo_i32", original);
    b.registerStruct("Foo_i32", duplicate);

    a.adopt(b);

    expect(a.products().structs.size).toBe(1);
    expect(a.getMonomorphizedStruct("Foo_i32")).toBe(original);
  });

  test("per-kind adopt* methods deduplicate by mangled name", () => {
    const a = createMonomorphization();
    const original = makeMonoStruct("Foo", "Foo_i32");
    const duplicate = makeMonoStruct("Foo", "Foo_i32");

    a.registerStruct("Foo_i32", original);
    a.adoptStruct("Foo_i32", duplicate);

    expect(a.getMonomorphizedStruct("Foo_i32")).toBe(original);

    const enumA = makeEnum("Optional_i32");
    const enumB = makeEnum("Optional_i32");
    a.registerEnum("Optional_i32", enumA);
    a.adoptEnum("Optional_i32", enumB);
    expect(a.getMonomorphizedEnum("Optional_i32")).toBe(enumA);

    const fnA = makeMonoFunction("identity", "identity_i32");
    const fnB = makeMonoFunction("identity", "identity_i32");
    a.registerFunction("identity_i32", fnA);
    a.adoptFunction("identity_i32", fnB);
    expect(a.getMonomorphizedFunction("identity_i32")).toBe(fnA);
  });

  test("adopt() merges structs, functions, and enums in a single call", () => {
    const a = createMonomorphization();
    const b = createMonomorphization();

    b.registerStruct("Box_i32", makeMonoStruct("Box", "Box_i32"));
    b.registerFunction("identity_i32", makeMonoFunction("identity", "identity_i32"));
    b.registerEnum("Optional_i32", makeEnum("Optional_i32"));

    a.adopt(b);

    const products = a.products();
    expect(products.structs.size).toBe(1);
    expect(products.functions.size).toBe(1);
    expect(products.enums.size).toBe(1);
    expect(products.structs.has("Box_i32")).toBe(true);
    expect(products.functions.has("identity_i32")).toBe(true);
    expect(products.enums.has("Optional_i32")).toBe(true);
  });
});
