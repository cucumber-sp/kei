import { describe, expect, test } from "bun:test";
import { TypeResolver } from "../../src/checker/type-resolver.ts";
import { Scope } from "../../src/checker/scope.ts";
import { typeSymbol } from "../../src/checker/symbols.ts";
import {
  I32_TYPE,
  I64_TYPE,
  U8_TYPE,
  F32_TYPE,
  F64_TYPE,
  BOOL_TYPE,
  VOID_TYPE,
  STRING_TYPE,
  C_CHAR_TYPE,
  ERROR_TYPE,
  TypeKind,
  ptrType,
  arrayType,
  sliceType,
  functionType,
} from "../../src/checker/types";
import type { TypeNode } from "../../src/ast/nodes.ts";
import type { Span } from "../../src/lexer/token.ts";
import type { StructType } from "../../src/checker/types";

const span: Span = { start: 0, end: 0 };

function namedType(name: string): TypeNode {
  return { kind: "NamedType", name, span } as TypeNode;
}

function genericType(name: string, typeArgs: TypeNode[]): TypeNode {
  return { kind: "GenericType", name, typeArgs, span } as TypeNode;
}

function makeStructType(
  name: string,
  fields: [string, import("../../src/checker/types").Type][],
  opts: { genericParams?: string[]; methods?: [string, import("../../src/checker/types").FunctionType][] } = {}
): StructType {
  return {
    kind: TypeKind.Struct,
    name,
    fields: new Map(fields),
    methods: new Map(opts.methods ?? []),
    isUnsafe: false,
    genericParams: opts.genericParams ?? [],
  };
}

describe("TypeResolver", () => {
  describe("resolve primitive types", () => {
    test("resolves basic integer types", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      expect(resolver.resolve(namedType("i32"), scope)).toEqual(I32_TYPE);
      expect(resolver.resolve(namedType("i64"), scope)).toEqual(I64_TYPE);
      expect(resolver.resolve(namedType("u8"), scope)).toEqual(U8_TYPE);
    });

    test("resolves float types", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      expect(resolver.resolve(namedType("f32"), scope)).toEqual(F32_TYPE);
      expect(resolver.resolve(namedType("f64"), scope)).toEqual(F64_TYPE);
    });

    test("resolves bool, void, string, c_char", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      expect(resolver.resolve(namedType("bool"), scope)).toEqual(BOOL_TYPE);
      expect(resolver.resolve(namedType("void"), scope)).toEqual(VOID_TYPE);
      expect(resolver.resolve(namedType("string"), scope)).toEqual(STRING_TYPE);
      expect(resolver.resolve(namedType("c_char"), scope)).toEqual(C_CHAR_TYPE);
    });

    test("resolves type aliases (int, long, float, double, byte, short)", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      expect(resolver.resolve(namedType("int"), scope)).toEqual(I32_TYPE);
      expect(resolver.resolve(namedType("long"), scope)).toEqual(I64_TYPE);
      expect(resolver.resolve(namedType("float"), scope)).toEqual(F32_TYPE);
      expect(resolver.resolve(namedType("double"), scope)).toEqual(F64_TYPE);
      expect(resolver.resolve(namedType("byte"), scope)).toEqual(U8_TYPE);
    });
  });

  describe("resolve user-defined types", () => {
    test("resolves a struct type from scope", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const myStruct = makeStructType("MyStruct", [["x", I32_TYPE]]);
      scope.define(typeSymbol("MyStruct", myStruct));

      const result = resolver.resolve(namedType("MyStruct"), scope);
      expect(result).toBe(myStruct);
    });

    test("returns ERROR_TYPE for undeclared type", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(namedType("Unknown"), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()).toHaveLength(1);
      expect(resolver.getDiagnostics()[0].message).toContain("undeclared type 'Unknown'");
    });
  });

  describe("type parameter substitutions", () => {
    test("resolves type parameter when substitution is set", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      resolver.setSubstitutions(new Map([["T", I32_TYPE]]));

      const result = resolver.resolve(namedType("T"), scope);
      expect(result).toEqual(I32_TYPE);
    });

    test("substitution takes priority over scope lookup", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const myStruct = makeStructType("T", [["x", I32_TYPE]]);
      scope.define(typeSymbol("T", myStruct));
      resolver.setSubstitutions(new Map([["T", BOOL_TYPE]]));

      const result = resolver.resolve(namedType("T"), scope);
      expect(result).toEqual(BOOL_TYPE);
    });

    test("clearSubstitutions removes substitutions", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      resolver.setSubstitutions(new Map([["T", I32_TYPE]]));
      resolver.clearSubstitutions();

      // Now "T" is not a substitution or a known type -> ERROR_TYPE
      const result = resolver.resolve(namedType("T"), scope);
      expect(result).toEqual(ERROR_TYPE);
    });
  });

  describe("diagnostics", () => {
    test("getDiagnostics returns accumulated errors", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      resolver.resolve(namedType("Foo"), scope);
      resolver.resolve(namedType("Bar"), scope);

      const diags = resolver.getDiagnostics();
      expect(diags).toHaveLength(2);
      expect(diags[0].message).toContain("Foo");
      expect(diags[1].message).toContain("Bar");
    });

    test("clearDiagnostics resets errors", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      resolver.resolve(namedType("Foo"), scope);
      expect(resolver.getDiagnostics()).toHaveLength(1);
      resolver.clearDiagnostics();
      expect(resolver.getDiagnostics()).toHaveLength(0);
    });

    test("diagnostics include span info", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const customSpan: Span = { start: 10, end: 20 };
      resolver.resolve({ kind: "NamedType", name: "Missing", span: customSpan } as TypeNode, scope);

      expect(resolver.getDiagnostics()[0].span).toEqual(customSpan);
    });
  });

  describe("resolve generic built-in types", () => {
    test("resolves ptr<T>", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("ptr", [namedType("i32")]), scope);
      expect(result).toEqual(ptrType(I32_TYPE));
    });

    test("ptr with wrong arity produces error", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("ptr", [namedType("i32"), namedType("bool")]), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()[0].message).toContain("expects exactly 1 type argument");
    });

    test("resolves array<T>", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("array", [namedType("bool")]), scope);
      expect(result).toEqual(arrayType(BOOL_TYPE));
    });

    test("resolves slice<T>", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("slice", [namedType("f64")]), scope);
      expect(result).toEqual(sliceType(F64_TYPE));
    });

    test("slice with wrong arity produces error", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("slice", [namedType("i32"), namedType("i64")]), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()[0].message).toContain("expects exactly 1 type argument");
    });

    test("nested generic: ptr<ptr<i32>>", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const inner = genericType("ptr", [namedType("i32")]);
      const result = resolver.resolve(genericType("ptr", [inner]), scope);
      expect(result).toEqual(ptrType(ptrType(I32_TYPE)));
    });
  });

  describe("resolve user-defined generic types", () => {
    test("instantiates generic struct with concrete type args", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const tParam = { kind: TypeKind.TypeParam, name: "T" } as const;
      const boxStruct = makeStructType("Box", [["value", tParam]], { genericParams: ["T"] });
      scope.define(typeSymbol("Box", boxStruct));

      const result = resolver.resolve(genericType("Box", [namedType("i32")]), scope);
      expect(result.kind).toBe(TypeKind.Struct);
      if (result.kind === TypeKind.Struct) {
        expect(result.name).toBe("Box_i32");
        expect(result.fields.get("value")).toEqual(I32_TYPE);
        expect(result.genericParams).toEqual([]);
      }
    });

    test("errors when type args given to non-generic struct", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const pointStruct = makeStructType("Point", [["x", I32_TYPE]]);
      scope.define(typeSymbol("Point", pointStruct));

      const result = resolver.resolve(genericType("Point", [namedType("i32")]), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()[0].message).toContain("not generic");
    });

    test("errors on wrong number of type args", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const tParam = { kind: TypeKind.TypeParam, name: "T" } as const;
      const uParam = { kind: TypeKind.TypeParam, name: "U" } as const;
      const pairStruct = makeStructType("Pair", [["first", tParam], ["second", uParam]], {
        genericParams: ["T", "U"],
      });
      scope.define(typeSymbol("Pair", pairStruct));

      const result = resolver.resolve(genericType("Pair", [namedType("i32")]), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()[0].message).toContain("expects 2 type argument(s)");
    });

    test("undeclared generic type produces error", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();

      const result = resolver.resolve(genericType("Nonexistent", [namedType("i32")]), scope);
      expect(result).toEqual(ERROR_TYPE);
      expect(resolver.getDiagnostics()[0].message).toContain("undeclared type 'Nonexistent'");
    });

    test("generic struct methods get substituted", () => {
      const resolver = new TypeResolver();
      const scope = new Scope();
      const tParam = { kind: TypeKind.TypeParam, name: "T" } as const;
      const getMethod = functionType(
        [{ name: "self", type: tParam, isMut: false, isMove: false }],
        tParam
      );
      const containerStruct = makeStructType("Container", [["value", tParam]], {
        genericParams: ["T"],
        methods: [["get", getMethod]],
      });
      scope.define(typeSymbol("Container", containerStruct));

      const result = resolver.resolve(genericType("Container", [namedType("bool")]), scope);
      expect(result.kind).toBe(TypeKind.Struct);
      if (result.kind === TypeKind.Struct) {
        const getMethodResult = result.methods.get("get");
        expect(getMethodResult).toBeDefined();
        expect(getMethodResult!.returnType).toEqual(BOOL_TYPE);
        expect(getMethodResult!.params[0].type).toEqual(BOOL_TYPE);
      }
    });
  });

  describe("substituteType delegation", () => {
    test("delegates to generics.substituteType", () => {
      const resolver = new TypeResolver();
      const tParam = { kind: TypeKind.TypeParam, name: "T" } as const;
      const subs = new Map([["T", I32_TYPE]]);

      const result = resolver.substituteType(tParam, subs);
      expect(result).toEqual(I32_TYPE);
    });
  });
});
