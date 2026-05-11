/**
 * Type substitution: replacing type parameters (e.g. `T`) with concrete types
 * (e.g. `i32`).
 *
 * Walks type trees and rebuilds compound types with substituted inner types.
 * Returns the original object by reference when no substitutions apply, so
 * callers can use identity checks for change detection.
 */

import type { FunctionType, Type } from "../checker/types";
import { arrayType, functionType, ptrType, rangeType, TypeKind } from "../checker/types";
import { mangleGenericName } from "./mangle";

/**
 * Pair a generic decl's `genericParams` (`["T", "U"]`) with an
 * instantiation's concrete `typeArgs` (`[i32, bool]`) and return the
 * resulting `name → Type` map. Shared by `check-bodies.ts` (drives the
 * bake) and the Checker's per-decl primitives so both halves of pass 3
 * agree on the substitution shape.
 */
export function buildTypeSubstitutionMap(
  genericParams: string[],
  typeArgs: Type[]
): Map<string, Type> {
  const subs = new Map<string, Type>();
  for (let i = 0; i < genericParams.length; i++) {
    const name = genericParams[i];
    const arg = typeArgs[i];
    if (name && arg) subs.set(name, arg);
  }
  return subs;
}

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
    case TypeKind.Ptr: {
      const subbed = ptrType(substituteType(type.pointee, typeMap));
      // Preserve the source-form bits (`ref T` vs `*T`).
      if (type.isRef) subbed.isRef = true;
      if (type.isReadonly) subbed.isReadonly = true;
      return subbed;
    }
    case TypeKind.Array:
      return arrayType(substituteType(type.element, typeMap), type.length);
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
      // Re-mangle name if this struct was a generic instantiation with TypeParam args
      let newName = type.name;
      if (type.genericBaseName && type.genericTypeArgs) {
        const subbedArgs = type.genericTypeArgs.map((a) => substituteType(a, typeMap));
        newName = mangleGenericName(type.genericBaseName, subbedArgs);
      }
      return {
        ...type,
        name: newName,
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
