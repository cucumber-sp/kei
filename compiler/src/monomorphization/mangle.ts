/**
 * Name mangling: generating unique names for monomorphized instances
 * (e.g. `Box_i32`).
 *
 * The mangled name is used as the key in the monomorphization cache and as the
 * concrete struct/function name in KIR and the C backend.
 */

import type { Type } from "../checker/types";
import { TypeKind, typeToString } from "../checker/types";

/**
 * Mangle a generic name with concrete type arguments to produce a unique identifier.
 *
 * Examples:
 * - `mangleGenericName("Pair", [i32, bool])` → `"Pair_i32_bool"`
 * - `mangleGenericName("Box", [ptr<i32>])` → `"Box_ptr_i32"`
 *
 * The mangled name is used as the key in the monomorphization cache and as the
 * concrete struct/function name in KIR and the C backend.
 *
 * @param baseName - The original generic type/function name
 * @param typeArgs - The concrete type arguments for this instantiation
 * @returns A unique mangled name for this specific instantiation
 */
export function mangleGenericName(baseName: string, typeArgs: Type[]): string {
  const argStrs = typeArgs.map((t) => mangleTypeName(t));
  return `${baseName}_${argStrs.join("_")}`;
}

/**
 * Mangle a single type into a name-safe string for use in mangled names.
 *
 * Produces short, deterministic identifiers:
 * - Integers: `i32`, `u64`
 * - Floats: `f32`, `f64`
 * - Primitives: `bool`, `string`, `void`, `c_char`
 * - Compound: `ptr_i32`, `array_bool`, `slice_string`
 * - Structs/Enums: their name directly (may already be mangled)
 * - Fallback: uses `typeToString` for unhandled kinds
 */
function mangleTypeName(t: Type): string {
  switch (t.kind) {
    case TypeKind.Int:
      return t.signed ? `i${t.bits}` : `u${t.bits}`;
    case TypeKind.Float:
      return `f${t.bits}`;
    case TypeKind.Bool:
      return "bool";
    case TypeKind.String:
      return "string";
    case TypeKind.Void:
      return "void";
    case TypeKind.CChar:
      return "c_char";
    case TypeKind.Ptr:
      return `ptr_${mangleTypeName(t.pointee)}`;
    case TypeKind.Array:
      return `array_${mangleTypeName(t.element)}`;
    case TypeKind.Struct:
      return t.name;
    case TypeKind.Enum:
      return t.name;
    default:
      return typeToString(t);
  }
}
