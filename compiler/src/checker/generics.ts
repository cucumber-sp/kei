/**
 * Generic type substitution and monomorphization utilities.
 *
 * This module handles the core mechanics of Kei's generics system:
 * - Type substitution: replacing type parameters (e.g. `T`) with concrete types (e.g. `i32`)
 * - Name mangling: generating unique names for monomorphized instances (e.g. `Box_i32`)
 * - Monomorphization metadata: tracking which generic types/functions have been instantiated
 *
 * The monomorphization approach creates a distinct concrete type for each unique set of
 * type arguments. For example, `Box<i32>` and `Box<bool>` become two separate struct types
 * named `Box_i32` and `Box_bool`.
 */

import type { FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes.ts";
import type { FunctionType, StructType, Type } from "./types.ts";
import { arrayType, functionType, ptrType, rangeType, sliceType, TypeKind, typeToString } from "./types.ts";

/**
 * Recursively substitute type parameters in a type using the given map.
 *
 * Walks the type structure and replaces any `TypeParam` nodes whose name appears
 * in `typeMap` with the corresponding concrete type. Compound types (Ptr, Array,
 * Slice, Range, Struct, Function) are rebuilt with substituted inner types.
 *
 * Returns the original type object unchanged (by reference) if no substitutions apply,
 * enabling cheap identity checks for change detection.
 *
 * @param type - The type to substitute within (may contain TypeParam nodes)
 * @param typeMap - Mapping from type parameter names to their concrete types
 * @returns The substituted type, or the original if unchanged
 */
export function substituteType(type: Type, typeMap: Map<string, Type>): Type {
  if (typeMap.size === 0) return type;
  switch (type.kind) {
    case TypeKind.TypeParam: {
      const sub = typeMap.get(type.name);
      return sub ?? type;
    }
    case TypeKind.Ptr:
      return ptrType(substituteType(type.pointee, typeMap));
    case TypeKind.Array:
      return arrayType(substituteType(type.element, typeMap), type.length);
    case TypeKind.Slice:
      return sliceType(substituteType(type.element, typeMap));
    case TypeKind.Range:
      return rangeType(substituteType(type.element, typeMap));
    case TypeKind.Struct: {
      // Substitute field types
      let changed = false;
      const newFields = new Map<string, Type>();
      for (const [fieldName, fieldType] of type.fields) {
        const subbed = substituteType(fieldType, typeMap);
        if (subbed !== fieldType) changed = true;
        newFields.set(fieldName, subbed);
      }
      // Substitute method types
      const newMethods = new Map<string, FunctionType>();
      for (const [methodName, methodType] of type.methods) {
        const subbed = substituteFunctionType(methodType, typeMap);
        if (subbed !== methodType) changed = true;
        newMethods.set(methodName, subbed);
      }
      if (!changed) return type;
      return {
        ...type,
        fields: newFields,
        methods: newMethods,
      };
    }
    case TypeKind.Function:
      return substituteFunctionType(type, typeMap);
    default:
      return type;
  }
}

/**
 * Substitute type parameters in a function type.
 *
 * Applies substitution to all parameter types, the return type, and any throws types.
 * The resulting function type has empty `genericParams` since it represents a fully
 * concrete instantiation.
 *
 * @param funcType - The generic function type to substitute within
 * @param typeMap - Mapping from type parameter names to their concrete types
 * @returns The substituted function type, or the original if unchanged
 */
export function substituteFunctionType(
  funcType: FunctionType,
  typeMap: Map<string, Type>
): FunctionType {
  if (typeMap.size === 0) return funcType;
  let changed = false;
  const newParams = funcType.params.map((p) => {
    const subbed = substituteType(p.type, typeMap);
    if (subbed !== p.type) changed = true;
    return { ...p, type: subbed };
  });
  const newReturnType = substituteType(funcType.returnType, typeMap);
  if (newReturnType !== funcType.returnType) changed = true;
  const newThrowsTypes = funcType.throwsTypes.map((t) => {
    const subbed = substituteType(t, typeMap);
    if (subbed !== t) changed = true;
    return subbed;
  });
  if (!changed) return funcType;
  return functionType(newParams, newReturnType, newThrowsTypes, [], funcType.isExtern);
}

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
    case TypeKind.Slice:
      return `slice_${mangleTypeName(t.element)}`;
    case TypeKind.Struct:
      return t.name;
    case TypeKind.Enum:
      return t.name;
    default:
      return typeToString(t);
  }
}

/**
 * Info about a monomorphized struct instance.
 *
 * Created when a generic struct like `Box<T>` is instantiated with concrete types
 * (e.g. `Box<i32>`). Stored in the checker's `monomorphizedStructs` cache, keyed
 * by the mangled name.
 */
export interface MonomorphizedStruct {
  /** The original generic struct type (with TypeParam fields). */
  original: StructType;
  /** The concrete type arguments used for this instantiation. */
  typeArgs: Type[];
  /** The fully-substituted concrete struct type. */
  concrete: StructType;
  /** Original AST declaration (needed for lowering methods). */
  originalDecl?: StructDecl | UnsafeStructDecl;
}

/**
 * Info about a monomorphized function instance.
 *
 * Created when a generic function like `identity<T>` is called with concrete types
 * (e.g. `identity<i32>(42)`). Stored in the checker's `monomorphizedFunctions` cache,
 * keyed by the mangled name.
 */
export interface MonomorphizedFunction {
  /** The original unmangled function name (e.g. `"identity"`). */
  originalName: string;
  /** The concrete type arguments used for this instantiation. */
  typeArgs: Type[];
  /** The fully-substituted concrete function type. */
  concrete: FunctionType;
  /** The mangled name for this instantiation (e.g. `"identity_i32"`). */
  mangledName: string;
  /** Original AST declaration (needed for lowering the body). */
  declaration?: FunctionDecl;
}
