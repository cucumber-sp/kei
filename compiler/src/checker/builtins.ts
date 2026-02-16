/**
 * Built-in types and functions for the Kei type checker.
 * Registers primitive types, aliases, and built-in functions in the global scope.
 */

import type { Scope } from "./scope.ts";
import { functionSymbol, typeSymbol, variableSymbol } from "./symbols.ts";
import type { Type } from "./types.ts";
import {
  BOOL_TYPE,
  C_CHAR_TYPE,
  F32_TYPE,
  F64_TYPE,
  functionType,
  I8_TYPE,
  I16_TYPE,
  I32_TYPE,
  I64_TYPE,
  ISIZE_TYPE,
  ptrType,
  STRING_TYPE,
  typeParamType,
  U8_TYPE,
  U16_TYPE,
  U32_TYPE,
  U64_TYPE,
  USIZE_TYPE,
  VOID_TYPE,
} from "./types.ts";

/** Map from primitive type name to its internal Type representation */
const PRIMITIVE_TYPE_MAP: ReadonlyMap<string, Type> = new Map([
  // Sized integer types
  ["i8", I8_TYPE],
  ["i16", I16_TYPE],
  ["i32", I32_TYPE],
  ["i64", I64_TYPE],
  ["u8", U8_TYPE],
  ["u16", U16_TYPE],
  ["u32", U32_TYPE],
  ["u64", U64_TYPE],
  ["isize", ISIZE_TYPE],
  ["usize", USIZE_TYPE],
  // Floating-point types
  ["f32", F32_TYPE],
  ["f64", F64_TYPE],
  // Other primitives
  ["bool", BOOL_TYPE],
  ["string", STRING_TYPE],
  ["void", VOID_TYPE],
  ["c_char", C_CHAR_TYPE],
  // Built-in aliases
  ["int", I32_TYPE],
  ["long", I64_TYPE],
  ["float", F32_TYPE],
  ["double", F64_TYPE],
  ["byte", U8_TYPE],
  ["short", I16_TYPE],
]);

/** Look up a primitive type by name. Returns undefined if not a primitive. */
export function lookupPrimitiveType(name: string): Type | undefined {
  return PRIMITIVE_TYPE_MAP.get(name);
}

/** Register all built-in types and functions in the given scope. */
export function registerBuiltins(scope: Scope): void {
  // Register primitive type symbols
  for (const [name, type] of PRIMITIVE_TYPE_MAP) {
    scope.define(typeSymbol(name, type));
  }

  // Register built-in functions

  // alloc<T>(count: usize) -> ptr<T> — requires unsafe
  scope.define(
    functionSymbol(
      "alloc",
      functionType(
        [{ name: "count", type: USIZE_TYPE, isMut: false, isMove: false }],
        ptrType(typeParamType("T")),
        [],
        ["T"],
        false
      ),
      false
    )
  );

  // free<T>(p: ptr<T>) -> void — requires unsafe
  scope.define(
    functionSymbol(
      "free",
      functionType(
        [{ name: "p", type: ptrType(typeParamType("T")), isMut: false, isMove: false }],
        VOID_TYPE,
        [],
        ["T"],
        false
      ),
      false
    )
  );

  // sizeof(T) -> usize — safe, takes a type not a value (special-cased)
  scope.define(
    functionSymbol(
      "sizeof",
      functionType(
        [{ name: "T", type: VOID_TYPE, isMut: false, isMove: false }],
        USIZE_TYPE,
        [],
        [],
        false
      ),
      false
    )
  );

  // panic(message: string) -> void — safe, noreturn
  scope.define(
    functionSymbol(
      "panic",
      functionType(
        [{ name: "message", type: STRING_TYPE, isMut: false, isMove: false }],
        VOID_TYPE,
        [],
        [],
        false
      ),
      false
    )
  );

  // print — overloaded for all common types
  scope.define(
    functionSymbol(
      "print",
      functionType(
        [{ name: "value", type: STRING_TYPE, isMut: false, isMove: false }],
        VOID_TYPE, [], [], false
      ),
      false
    )
  );
  scope.define(
    functionSymbol(
      "print",
      functionType(
        [{ name: "value", type: I32_TYPE, isMut: false, isMove: false }],
        VOID_TYPE, [], [], false
      ),
      false
    )
  );
  scope.define(
    functionSymbol(
      "print",
      functionType(
        [{ name: "value", type: I64_TYPE, isMut: false, isMove: false }],
        VOID_TYPE, [], [], false
      ),
      false
    )
  );
  scope.define(
    functionSymbol(
      "print",
      functionType(
        [{ name: "value", type: F64_TYPE, isMut: false, isMove: false }],
        VOID_TYPE, [], [], false
      ),
      false
    )
  );
  scope.define(
    functionSymbol(
      "print",
      functionType(
        [{ name: "value", type: BOOL_TYPE, isMut: false, isMove: false }],
        VOID_TYPE, [], [], false
      ),
      false
    )
  );

  // Register true/false as constants
  scope.define(variableSymbol("true", BOOL_TYPE, false, true));
  scope.define(variableSymbol("false", BOOL_TYPE, false, true));
}
