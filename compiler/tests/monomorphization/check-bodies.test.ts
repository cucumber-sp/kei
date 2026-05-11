/**
 * Monomorphization.checkBodies — driver iteration contract.
 *
 * Construct a `Monomorphization`, register one or more instantiations,
 * call `checkBodies` with a stub callback that records what it sees,
 * and assert the callback was invoked once per registered product in
 * the expected order (functions first, then structs).  The stub does
 * no real type-checking; this test pins the driver's iteration shape
 * independently of the checker primitive that runs underneath it in
 * production.
 *
 * Cases (per `docs/migrations/monomorphization/pr-3.md`):
 *   1. checkBodies invokes the callback once per registered function
 *   2. checkBodies invokes the callback once per registered struct
 *   3. checkBodies visits functions before structs
 *   4. checkBodies is a no-op when nothing is registered
 */

import { describe, expect, test } from "bun:test";
import type { EnumType, FunctionType, StructType } from "../../src/checker/types";
import { TypeKind, VOID_TYPE } from "../../src/checker/types";
import type {
  MonomorphizedFunction,
  MonomorphizedProduct,
  MonomorphizedStruct,
} from "../../src/monomorphization";
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

function makeMonoStruct(genericName: string, mangledName: string): MonomorphizedStruct {
  const original = makeStruct(genericName);
  original.genericParams = ["T"];
  return {
    original,
    typeArgs: [{ kind: TypeKind.Int, bits: 32, signed: true }],
    concrete: makeStruct(mangledName),
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

function makeEnum(name: string): EnumType {
  return {
    kind: TypeKind.Enum,
    name,
    baseType: null,
    variants: [],
    genericParams: [],
  };
}

describe("Monomorphization.checkBodies", () => {
  test("invokes the callback once per registered function", () => {
    const mono = createMonomorphization();
    const info = makeMonoFunction("identity", "identity_i32");
    mono.registerFunction("identity_i32", info);

    const seen: MonomorphizedProduct[] = [];
    mono.checkBodies((product) => seen.push(product));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ kind: "function", product: info });
  });

  test("invokes the callback once per registered struct", () => {
    const mono = createMonomorphization();
    const info = makeMonoStruct("Box", "Box_i32");
    mono.registerStruct("Box_i32", info);

    const seen: MonomorphizedProduct[] = [];
    mono.checkBodies((product) => seen.push(product));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ kind: "struct", product: info });
  });

  test("visits functions before structs", () => {
    const mono = createMonomorphization();
    const func = makeMonoFunction("identity", "identity_i32");
    const struct = makeMonoStruct("Box", "Box_i32");
    // Register struct first to verify the driver imposes its own order.
    mono.registerStruct("Box_i32", struct);
    mono.registerFunction("identity_i32", func);

    const kinds: string[] = [];
    mono.checkBodies((product) => kinds.push(product.kind));

    expect(kinds).toEqual(["function", "struct"]);
  });

  test("is a no-op when nothing is registered", () => {
    const mono = createMonomorphization();
    // Register an enum to confirm enums are NOT part of the body-check
    // sweep — enum instantiations don't carry method bodies.
    mono.registerEnum("Optional_i32", makeEnum("Optional_i32"));

    let calls = 0;
    mono.checkBodies(() => {
      calls += 1;
    });

    expect(calls).toBe(0);
  });
});
