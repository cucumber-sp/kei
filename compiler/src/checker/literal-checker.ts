/**
 * Type-checks literal expressions: int, float, string, bool, null, array, and struct literals.
 * Includes generic struct instantiation (explicit and inferred).
 */

import type {
  ArrayLiteral,
  BoolLiteral,
  FloatLiteral,
  IntLiteral,
  NullLiteral,
  StringLiteral,
  StructLiteral,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { mangleGenericName, substituteFunctionType, substituteType } from "./generics.ts";
import { SymbolKind } from "./symbols.ts";
import { I32_MIN, I32_MAX } from "../utils/constants.ts";
import type { ArrayType, PtrType, RangeType, SliceType, StructType, Type } from "./types";
import {
  arrayType,
  BOOL_TYPE,
  ERROR_TYPE,
  extractLiteralInfo,
  F64_TYPE,
  I32_TYPE,
  I64_TYPE,
  isAssignableTo,
  isErrorType,
  isLiteralAssignableTo,
  NULL_TYPE,
  ptrType,
  rangeType,
  STRING_TYPE,
  TypeKind,
  typeToString,
} from "./types";

export function checkIntLiteral(expr: IntLiteral): Type {
  const v = expr.value;
  if (v >= I32_MIN && v <= I32_MAX) {
    return I32_TYPE;
  }
  return I64_TYPE;
}

export function checkFloatLiteral(_expr: FloatLiteral): Type {
  return F64_TYPE;
}

export function checkStringLiteral(_expr: StringLiteral): Type {
  return STRING_TYPE;
}

export function checkBoolLiteral(_expr: BoolLiteral): Type {
  return BOOL_TYPE;
}

export function checkNullLiteral(_expr: NullLiteral): Type {
  return NULL_TYPE;
}

export function checkArrayLiteral(checker: Checker, expr: ArrayLiteral): Type {
  if (expr.elements.length === 0) {
    checker.error("empty array literal — cannot infer element type", expr.span);
    return ERROR_TYPE;
  }

  const firstType = checker.checkExpression(expr.elements[0]!);
  if (isErrorType(firstType)) return ERROR_TYPE;

  for (let i = 1; i < expr.elements.length; i++) {
    const elemType = checker.checkExpression(expr.elements[i]!);
    if (isErrorType(elemType)) continue;
    if (!isAssignableTo(elemType, firstType)) {
      // Check literal assignability
      const litInfo = extractLiteralInfo(expr.elements[i]!);
      const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, firstType);
      if (!isLiteralOk) {
        checker.error(
          `array element ${i}: expected '${typeToString(firstType)}', got '${typeToString(elemType)}'`,
          expr.elements[i]!.span
        );
      }
    }
  }

  return arrayType(firstType, expr.elements.length);
}

export function checkStructLiteral(checker: Checker, expr: StructLiteral): Type {
  // Look up the struct type
  const sym = checker.currentScope.lookupType(expr.name);
  if (!sym || sym.kind !== SymbolKind.Type) {
    checker.error(`undeclared type '${expr.name}'`, expr.span);
    return ERROR_TYPE;
  }

  let structType = sym.type;

  // Handle generic struct instantiation with explicit type args
  if (structType.kind === TypeKind.Struct && expr.typeArgs.length > 0) {
    if (structType.genericParams.length === 0) {
      checker.error(
        `type '${expr.name}' expects 0 type argument(s), got ${expr.typeArgs.length}`,
        expr.span
      );
      return ERROR_TYPE;
    }
    const result = instantiateGenericStruct(checker, structType, expr);
    if (isErrorType(result)) return ERROR_TYPE;
    structType = result;
  }

  if (structType.kind !== TypeKind.Struct) {
    checker.error(`'${expr.name}' is not a struct type`, expr.span);
    return ERROR_TYPE;
  }

  // Infer generic type params from field values when no explicit type args
  if (structType.genericParams.length > 0 && expr.typeArgs.length === 0) {
    return checkGenericStructLiteralInferred(checker, structType, expr);
  }

  // Check all fields are provided
  const providedFields = new Set<string>();
  for (const field of expr.fields) {
    if (providedFields.has(field.name)) {
      checker.error(`duplicate field '${field.name}' in struct literal`, field.span);
      continue;
    }
    providedFields.add(field.name);

    const expectedType = structType.fields.get(field.name);
    if (!expectedType) {
      checker.error(`struct '${structType.name}' has no field '${field.name}'`, field.span);
      continue;
    }

    const valueType = checker.checkExpression(field.value);
    if (!isErrorType(valueType) && !isAssignableTo(valueType, expectedType)) {
      // Check if this is a literal that can be implicitly converted
      const litInfo = extractLiteralInfo(field.value);
      const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, expectedType);
      if (isLiteralOk) {
        // Update typeMap so KIR lowering uses the correct type (e.g. i32 literal → f64)
        checker.setExprType(field.value, expectedType);
      } else {
        checker.error(
          `field '${field.name}': expected '${typeToString(expectedType)}', got '${typeToString(valueType)}'`,
          field.span
        );
      }
    }
  }

  // Check all required fields are present
  for (const [fieldName] of structType.fields) {
    if (!providedFields.has(fieldName)) {
      checker.error(
        `missing field '${fieldName}' in struct literal '${structType.name}'`,
        expr.span
      );
    }
  }

  return structType;
}

/** Instantiate a generic struct with explicit type args, using the monomorphization cache. */
function instantiateGenericStruct(
  checker: Checker,
  baseStruct: StructType,
  expr: StructLiteral
): Type {
  if (expr.typeArgs.length !== baseStruct.genericParams.length) {
    const paramHint = baseStruct.genericParams.length > 0
      ? ` <${baseStruct.genericParams.join(", ")}>`
      : "";
    checker.error(
      `type '${baseStruct.name}' expects ${baseStruct.genericParams.length} type argument(s)${paramHint}, got ${expr.typeArgs.length}`,
      expr.span
    );
    return ERROR_TYPE;
  }

  // Resolve type args
  const resolvedTypeArgs: Type[] = [];
  const typeMap = new Map<string, Type>();
  for (let i = 0; i < expr.typeArgs.length; i++) {
    const typeArg = expr.typeArgs[i]!;
    const resolved = checker.resolveType(typeArg);
    if (isErrorType(resolved)) return ERROR_TYPE;
    resolvedTypeArgs.push(resolved);
    typeMap.set(baseStruct.genericParams[i]!, resolved);
  }

  const mangledName = mangleGenericName(baseStruct.name, resolvedTypeArgs);

  // Check cache first
  const cached = checker.getMonomorphizedStruct(mangledName);
  if (cached) return cached.concrete;

  // Create concrete struct type
  const concreteFields = new Map<string, Type>();
  for (const [fieldName, fieldType] of baseStruct.fields) {
    concreteFields.set(fieldName, substituteType(fieldType, typeMap));
  }

  // Create concrete struct first (methods added after so self-references resolve)
  const concreteStruct: StructType = {
    kind: TypeKind.Struct,
    name: mangledName,
    fields: concreteFields,
    methods: new Map(),
    isUnsafe: baseStruct.isUnsafe,
    genericParams: [],
  };

  substituteStructMethods(baseStruct, concreteStruct, typeMap);

  checker.registerMonomorphizedStruct(mangledName, {
    original: baseStruct,
    typeArgs: resolvedTypeArgs,
    concrete: concreteStruct,
    // originalDecl will be resolved later in checkMonomorphizedBodies
  });

  // Store generic resolution for the struct literal
  checker.genericResolutions.set(expr, mangledName);

  return concreteStruct;
}

/** Handle generic struct literal where type params are inferred from field values. */
function checkGenericStructLiteralInferred(
  checker: Checker,
  structType: StructType,
  expr: StructLiteral
): Type {
  // First, check all field values to get their types
  const fieldValueTypes = new Map<string, Type>();
  const providedFields = new Set<string>();

  for (const field of expr.fields) {
    if (providedFields.has(field.name)) {
      checker.error(`duplicate field '${field.name}' in struct literal`, field.span);
      continue;
    }
    providedFields.add(field.name);

    if (!structType.fields.has(field.name)) {
      checker.error(`struct '${structType.name}' has no field '${field.name}'`, field.span);
      continue;
    }

    const valueType = checker.checkExpression(field.value);
    fieldValueTypes.set(field.name, valueType);
  }

  // Check all required fields are present
  for (const [fieldName] of structType.fields) {
    if (!providedFields.has(fieldName)) {
      checker.error(
        `missing field '${fieldName}' in struct literal '${structType.name}'`,
        expr.span
      );
    }
  }

  // Infer type param substitutions from field types (recursive)
  const subs = new Map<string, Type>();
  for (const [fieldName, fieldType] of structType.fields) {
    const valueType = fieldValueTypes.get(fieldName);
    if (valueType && !isErrorType(valueType)) {
      extractTypeParamSubs(fieldType, valueType, subs);
    }
  }

  // Build resolved type args from inferred subs
  const resolvedTypeArgs = structType.genericParams.map((gp) => subs.get(gp)!);
  const allInferred = resolvedTypeArgs.every((t) => t !== undefined);

  if (allInferred) {
    const mangledName = mangleGenericName(structType.name, resolvedTypeArgs);

    // Check cache
    const cached = checker.getMonomorphizedStruct(mangledName);
    if (cached) return cached.concrete;

    // Create concrete struct type (methods added after so self-references resolve)
    const newFields = new Map<string, Type>();
    for (const [fieldName, fieldType] of structType.fields) {
      newFields.set(fieldName, substituteType(fieldType, subs));
    }

    const concreteStruct: StructType = {
      kind: TypeKind.Struct,
      name: mangledName,
      fields: newFields,
      methods: new Map(),
      isUnsafe: structType.isUnsafe,
      genericParams: [],
    };

    substituteStructMethods(structType, concreteStruct, subs);

    checker.registerMonomorphizedStruct(mangledName, {
      original: structType,
      typeArgs: resolvedTypeArgs,
      concrete: concreteStruct,
    });

    // Store generic resolution for the struct literal
    checker.genericResolutions.set(expr, mangledName);

    return concreteStruct;
  }

  // Fallback: could not fully infer all type params
  const uninferred = structType.genericParams.filter((gp) => !subs.has(gp));
  checker.error(
    `cannot infer type parameter(s) '${uninferred.join("', '")}' for struct '${structType.name}' — provide explicit type arguments`,
    expr.span
  );
  return ERROR_TYPE;
}

/** Substitute base struct methods into concrete struct, fixing self-referential types. */
function substituteStructMethods(
  base: StructType,
  concrete: StructType,
  typeMap: Map<string, Type>
): void {
  const isSelfRef = (t: Type) =>
    t.kind === TypeKind.Struct &&
    (t.name === base.name || t.name.startsWith(base.name + "_"));
  for (const [methodName, methodType] of base.methods) {
    const subbed = substituteFunctionType(methodType, typeMap);
    const fixedParams = subbed.params.map((p) =>
      isSelfRef(p.type) ? { ...p, type: concrete } : p
    );
    const fixedReturn = isSelfRef(subbed.returnType) ? concrete : subbed.returnType;
    concrete.methods.set(methodName, {
      ...subbed,
      params: fixedParams,
      returnType: fixedReturn,
    });
  }
}

/** Recursively extract TypeParam→concrete type mappings by walking declared and concrete types. */
export function extractTypeParamSubs(declared: Type, concrete: Type, subs: Map<string, Type>): void {
  if (declared.kind === TypeKind.TypeParam) {
    if (!subs.has(declared.name)) {
      subs.set(declared.name, concrete);
    }
    return;
  }
  if (declared.kind !== concrete.kind) return;
  switch (declared.kind) {
    case TypeKind.Ptr:
      extractTypeParamSubs(declared.pointee, (concrete as PtrType).pointee, subs);
      break;
    case TypeKind.Array:
      extractTypeParamSubs(declared.element, (concrete as ArrayType).element, subs);
      break;
    case TypeKind.Slice:
      extractTypeParamSubs(declared.element, (concrete as SliceType).element, subs);
      break;
    case TypeKind.Range:
      extractTypeParamSubs(declared.element, (concrete as RangeType).element, subs);
      break;
    case TypeKind.Struct: {
      const concreteStruct = concrete as StructType;
      for (const [fieldName, fieldType] of declared.fields) {
        const concreteField = concreteStruct.fields.get(fieldName);
        if (concreteField) {
          extractTypeParamSubs(fieldType, concreteField, subs);
        }
      }
      break;
    }
  }
}
