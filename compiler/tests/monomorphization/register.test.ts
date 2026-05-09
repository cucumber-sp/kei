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
