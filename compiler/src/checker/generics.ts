/**
 * Generic type substitution and monomorphization utilities.
 */

import type { FunctionType, StructType, Type } from "./types.ts";
import { arrayType, functionType, ptrType, rangeType, sliceType, TypeKind, typeToString } from "./types.ts";

/** Recursively substitute type parameters in a type using the given map. */
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

/** Substitute type parameters in a function type. */
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

/** Mangle a generic name with concrete type args: Pair + [i32, bool] → Pair_i32_bool */
export function mangleGenericName(baseName: string, typeArgs: Type[]): string {
  const argStrs = typeArgs.map((t) => mangleTypeName(t));
  return `${baseName}_${argStrs.join("_")}`;
}

/** Mangle a single type into a name-safe string for use in mangled names. */
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

/** Info about a monomorphized struct instance. */
export interface MonomorphizedStruct {
  original: StructType;
  typeArgs: Type[];
  concrete: StructType;
}

/** Info about a monomorphized function instance. */
export interface MonomorphizedFunction {
  originalName: string;
  typeArgs: Type[];
  concrete: FunctionType;
  mangledName: string;
}
