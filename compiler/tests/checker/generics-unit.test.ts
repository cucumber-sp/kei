import { describe, expect, test } from "bun:test";
import {
  mangleGenericName,
  substituteFunctionType,
  substituteType,
} from "../../src/checker/generics.ts";
import type { FunctionType, StructType, Type } from "../../src/checker/types";
import {
  arrayType,
  BOOL_TYPE,
  C_CHAR_TYPE,
  ERROR_TYPE,
  F32_TYPE,
  F64_TYPE,
  functionType,
  I32_TYPE,
  I64_TYPE,
  ptrType,
  rangeType,
  STRING_TYPE,
  sliceType,
  TypeKind,
  U8_TYPE,
  U64_TYPE,
  VOID_TYPE,
} from "../../src/checker/types";

function typeParam(name: string): Type {
  return { kind: TypeKind.TypeParam, name } as Type;
}

function makeStructType(
  name: string,
  fields: [string, Type][],
  methods: [string, FunctionType][] = [],
  genericParams: string[] = []
): StructType {
  return {
    kind: TypeKind.Struct,
    name,
    fields: new Map(fields),
    methods: new Map(methods),
    isUnsafe: false,
    genericParams,
  };
}

describe("substituteType", () => {
  test("returns original type when typeMap is empty", () => {
    const t = I32_TYPE;
    const result = substituteType(t, new Map());
    expect(result).toBe(t); // same reference
  });

  test("substitutes TypeParam found in map", () => {
    const result = substituteType(typeParam("T"), new Map([["T", I32_TYPE]]));
    expect(result).toEqual(I32_TYPE);
  });

  test("returns original TypeParam when not in map", () => {
    const t = typeParam("U");
    const result = substituteType(t, new Map([["T", I32_TYPE]]));
    expect(result).toBe(t);
  });

  test("substitutes Ptr pointee", () => {
    const t = ptrType(typeParam("T"));
    const result = substituteType(t, new Map([["T", I32_TYPE]]));
    expect(result).toEqual(ptrType(I32_TYPE));
  });

  test("substitutes Array element and preserves length", () => {
    const t = arrayType(typeParam("T"), 5);
    const result = substituteType(t, new Map([["T", BOOL_TYPE]]));
    expect(result).toEqual(arrayType(BOOL_TYPE, 5));
  });

  test("substitutes Array element without length", () => {
    const t = arrayType(typeParam("T"));
    const result = substituteType(t, new Map([["T", I64_TYPE]]));
    expect(result).toEqual(arrayType(I64_TYPE));
  });

  test("substitutes Slice element", () => {
    const t = sliceType(typeParam("T"));
    const result = substituteType(t, new Map([["T", STRING_TYPE]]));
    expect(result).toEqual(sliceType(STRING_TYPE));
  });

  test("substitutes Range element", () => {
    const t = rangeType(typeParam("T"));
    const result = substituteType(t, new Map([["T", I32_TYPE]]));
    expect(result).toEqual(rangeType(I32_TYPE));
  });

  test("substitutes Struct field types", () => {
    const s = makeStructType("Box", [["value", typeParam("T")]]);
    const result = substituteType(s, new Map([["T", I32_TYPE]]));
    expect(result.kind).toBe(TypeKind.Struct);
    if (result.kind === TypeKind.Struct) {
      expect(result.fields.get("value")).toEqual(I32_TYPE);
    }
  });

  test("returns original Struct when no fields change", () => {
    const s = makeStructType("Point", [
      ["x", I32_TYPE],
      ["y", I32_TYPE],
    ]);
    const result = substituteType(s, new Map([["T", BOOL_TYPE]]));
    expect(result).toBe(s); // same reference, nothing to substitute
  });

  test("substitutes Struct method types", () => {
    const method = functionType(
      [{ name: "self", type: typeParam("T"), isMut: false, isMove: false }],
      typeParam("T")
    );
    const s = makeStructType("Container", [["val", typeParam("T")]], [["get", method]]);
    const result = substituteType(s, new Map([["T", F64_TYPE]]));
    if (result.kind === TypeKind.Struct) {
      const m = result.methods.get("get");
      expect(m).toBeDefined();
      expect(m!.returnType).toEqual(F64_TYPE);
      expect(m!.params[0].type).toEqual(F64_TYPE);
    }
  });

  test("substitutes Function type via delegation", () => {
    const fn = functionType(
      [{ name: "x", type: typeParam("T"), isMut: false, isMove: false }],
      typeParam("T")
    );
    const result = substituteType(fn, new Map([["T", BOOL_TYPE]]));
    expect(result.kind).toBe(TypeKind.Function);
    if (result.kind === TypeKind.Function) {
      expect(result.params[0].type).toEqual(BOOL_TYPE);
      expect(result.returnType).toEqual(BOOL_TYPE);
    }
  });

  test("returns primitive types unchanged", () => {
    const subs = new Map([["T", I32_TYPE]]);
    expect(substituteType(BOOL_TYPE, subs)).toBe(BOOL_TYPE);
    expect(substituteType(VOID_TYPE, subs)).toBe(VOID_TYPE);
    expect(substituteType(STRING_TYPE, subs)).toBe(STRING_TYPE);
    expect(substituteType(I64_TYPE, subs)).toBe(I64_TYPE);
    expect(substituteType(ERROR_TYPE, subs)).toBe(ERROR_TYPE);
  });

  test("handles nested compound types", () => {
    // ptr<array<T>>
    const t = ptrType(arrayType(typeParam("T")));
    const result = substituteType(t, new Map([["T", F32_TYPE]]));
    expect(result).toEqual(ptrType(arrayType(F32_TYPE)));
  });
});

describe("substituteFunctionType", () => {
  test("returns original when typeMap is empty", () => {
    const fn = functionType(
      [{ name: "x", type: I32_TYPE, isMut: false, isMove: false }],
      VOID_TYPE
    );
    const result = substituteFunctionType(fn, new Map());
    expect(result).toBe(fn);
  });

  test("returns original when nothing changes", () => {
    const fn = functionType(
      [{ name: "x", type: I32_TYPE, isMut: false, isMove: false }],
      VOID_TYPE
    );
    const result = substituteFunctionType(fn, new Map([["T", BOOL_TYPE]]));
    expect(result).toBe(fn);
  });

  test("substitutes parameter types", () => {
    const fn = functionType(
      [{ name: "x", type: typeParam("T"), isMut: false, isMove: false }],
      VOID_TYPE
    );
    const result = substituteFunctionType(fn, new Map([["T", I32_TYPE]]));
    expect(result.params[0].type).toEqual(I32_TYPE);
  });

  test("substitutes return type", () => {
    const fn = functionType([], typeParam("T"));
    const result = substituteFunctionType(fn, new Map([["T", BOOL_TYPE]]));
    expect(result.returnType).toEqual(BOOL_TYPE);
  });

  test("substitutes throws types", () => {
    const errStruct = makeStructType("MyError", [["msg", typeParam("T")]]);
    const fn = functionType([], VOID_TYPE, [errStruct]);
    const result = substituteFunctionType(fn, new Map([["T", STRING_TYPE]]));
    expect(result.throwsTypes).toHaveLength(1);
    if (result.throwsTypes[0].kind === TypeKind.Struct) {
      expect(result.throwsTypes[0].fields.get("msg")).toEqual(STRING_TYPE);
    }
  });

  test("preserves isExtern flag", () => {
    const fn = functionType(
      [{ name: "x", type: typeParam("T"), isMut: false, isMove: false }],
      VOID_TYPE,
      [],
      [],
      true // isExtern
    );
    const result = substituteFunctionType(fn, new Map([["T", I32_TYPE]]));
    expect(result.isExtern).toBe(true);
  });

  test("clears genericParams in result", () => {
    const fn = functionType(
      [{ name: "x", type: typeParam("T"), isMut: false, isMove: false }],
      typeParam("T"),
      [],
      ["T"]
    );
    const result = substituteFunctionType(fn, new Map([["T", I32_TYPE]]));
    expect(result.genericParams).toEqual([]);
  });
});

describe("mangleGenericName", () => {
  test("mangles with integer types", () => {
    expect(mangleGenericName("Box", [I32_TYPE])).toBe("Box_i32");
    expect(mangleGenericName("Pair", [I32_TYPE, I64_TYPE])).toBe("Pair_i32_i64");
  });

  test("mangles with unsigned integer types", () => {
    expect(mangleGenericName("Buf", [U8_TYPE])).toBe("Buf_u8");
    expect(mangleGenericName("Buf", [U64_TYPE])).toBe("Buf_u64");
  });

  test("mangles with float types", () => {
    expect(mangleGenericName("Vec", [F32_TYPE])).toBe("Vec_f32");
    expect(mangleGenericName("Vec", [F64_TYPE])).toBe("Vec_f64");
  });

  test("mangles with bool, string, void, c_char", () => {
    expect(mangleGenericName("X", [BOOL_TYPE])).toBe("X_bool");
    expect(mangleGenericName("X", [STRING_TYPE])).toBe("X_string");
    expect(mangleGenericName("X", [VOID_TYPE])).toBe("X_void");
    expect(mangleGenericName("X", [C_CHAR_TYPE])).toBe("X_c_char");
  });

  test("mangles with pointer types", () => {
    expect(mangleGenericName("Box", [ptrType(I32_TYPE)])).toBe("Box_ptr_i32");
  });

  test("mangles with array types", () => {
    expect(mangleGenericName("Wrap", [arrayType(BOOL_TYPE)])).toBe("Wrap_array_bool");
  });

  test("mangles with slice types", () => {
    expect(mangleGenericName("Wrap", [sliceType(I32_TYPE)])).toBe("Wrap_slice_i32");
  });

  test("mangles with struct types", () => {
    const s = makeStructType("Inner", []);
    expect(mangleGenericName("Outer", [s])).toBe("Outer_Inner");
  });

  test("mangles nested compound types", () => {
    // ptr<array<i32>>
    expect(mangleGenericName("X", [ptrType(arrayType(I32_TYPE))])).toBe("X_ptr_array_i32");
  });

  test("mangles with multiple type args", () => {
    expect(mangleGenericName("Map", [STRING_TYPE, I32_TYPE])).toBe("Map_string_i32");
  });

  test("mangles with enum type", () => {
    const enumType: Type = {
      kind: TypeKind.Enum,
      name: "Color",
      baseType: null,
      variants: [],
    };
    expect(mangleGenericName("X", [enumType])).toBe("X_Color");
  });
});
