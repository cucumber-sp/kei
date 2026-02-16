/**
 * Resolves AST TypeNode → internal Type.
 * Handles primitives, aliases, generics, and user-defined types.
 */

import type { TypeNode } from "../ast/nodes.ts";
import type { Span } from "../lexer/token.ts";
import { lookupPrimitiveType } from "./builtins.ts";
import { mangleGenericName, substituteType as substituteTypeGeneric, substituteFunctionType } from "./generics.ts";
import type { Scope } from "./scope.ts";
import { SymbolKind } from "./symbols.ts";
import type { FunctionType, Type } from "./types.ts";
import {
  arrayType,
  ERROR_TYPE,
  isStructType,
  ptrType,
  sliceType,
  TypeKind,
  typeToString,
} from "./types.ts";

export interface TypeResolverDiagnostic {
  message: string;
  span: Span;
}

export class TypeResolver {
  private diagnostics: TypeResolverDiagnostic[] = [];
  private typeSubstitutions: Map<string, Type> = new Map();

  getDiagnostics(): ReadonlyArray<TypeResolverDiagnostic> {
    return this.diagnostics;
  }

  clearDiagnostics(): void {
    this.diagnostics = [];
  }

  /** Set type parameter substitutions for generic instantiation. */
  setSubstitutions(subs: Map<string, Type>): void {
    this.typeSubstitutions = subs;
  }

  clearSubstitutions(): void {
    this.typeSubstitutions = new Map();
  }

  /** Resolve an AST TypeNode to an internal Type. */
  resolve(node: TypeNode, scope: Scope): Type {
    switch (node.kind) {
      case "NamedType":
        return this.resolveNamedType(node.name, node.span, scope);
      case "GenericType":
        return this.resolveGenericType(node.name, node.typeArgs, node.span, scope);
    }
  }

  private resolveNamedType(name: string, span: Span, scope: Scope): Type {
    // Check type parameter substitutions first
    const sub = this.typeSubstitutions.get(name);
    if (sub) return sub;

    // Check primitives and built-in aliases
    const primitive = lookupPrimitiveType(name);
    if (primitive) return primitive;

    // Check user-defined types in scope
    const sym = scope.lookupType(name);
    if (sym && sym.kind === SymbolKind.Type) {
      return sym.type;
    }

    this.addError(`undeclared type '${name}'`, span);
    return ERROR_TYPE;
  }

  private resolveGenericType(name: string, typeArgs: TypeNode[], span: Span, scope: Scope): Type {
    // Built-in generic types
    if (name === "ptr") {
      if (typeArgs.length !== 1) {
        this.addError("'ptr' expects exactly 1 type argument", span);
        return ERROR_TYPE;
      }
      const ptrArg = typeArgs[0];
      if (!ptrArg) return ERROR_TYPE;
      const pointee = this.resolve(ptrArg, scope);
      return ptrType(pointee);
    }

    if (name === "array" || name === "dynarray") {
      if (typeArgs.length < 1) {
        this.addError(`'${name}' expects at least 1 type argument`, span);
        return ERROR_TYPE;
      }
      const arrayArg = typeArgs[0];
      if (!arrayArg) return ERROR_TYPE;
      const element = this.resolve(arrayArg, scope);
      return arrayType(element);
    }

    if (name === "slice") {
      if (typeArgs.length !== 1) {
        this.addError("'slice' expects exactly 1 type argument", span);
        return ERROR_TYPE;
      }
      const sliceArg = typeArgs[0];
      if (!sliceArg) return ERROR_TYPE;
      const element = this.resolve(sliceArg, scope);
      return sliceType(element);
    }

    // User-defined generic types (e.g., Pair<int, string>)
    const sym = scope.lookupType(name);
    if (sym && sym.kind === SymbolKind.Type) {
      const baseType = sym.type;
      if (isStructType(baseType)) {
        if (baseType.genericParams.length === 0) {
          this.addError(`type '${name}' is not generic`, span);
          return ERROR_TYPE;
        }
        if (typeArgs.length !== baseType.genericParams.length) {
          this.addError(
            `type '${name}' expects ${baseType.genericParams.length} type argument(s), got ${typeArgs.length}`,
            span
          );
          return ERROR_TYPE;
        }
        // Create a substituted struct type
        return this.instantiateStructType(baseType, typeArgs, scope);
      }
      return baseType;
    }

    this.addError(`undeclared type '${name}'`, span);
    return ERROR_TYPE;
  }

  /** Instantiate a generic struct with concrete type arguments. */
  private instantiateStructType(
    base: import("./types.ts").StructType,
    typeArgs: TypeNode[],
    scope: Scope
  ): Type {
    const subs = new Map<string, Type>();
    const resolvedTypeArgs: Type[] = [];
    for (let i = 0; i < base.genericParams.length; i++) {
      const typeArg = typeArgs[i];
      if (!typeArg) continue;
      const paramName = base.genericParams[i];
      if (!paramName) continue;
      const resolvedArg = this.resolve(typeArg, scope);
      subs.set(paramName, resolvedArg);
      resolvedTypeArgs.push(resolvedArg);
    }

    const mangledName = mangleGenericName(base.name, resolvedTypeArgs);

    // Substitute field types
    const newFields = new Map<string, Type>();
    for (const [fieldName, fieldType] of base.fields) {
      newFields.set(fieldName, substituteTypeGeneric(fieldType, subs));
    }

    // Substitute method types
    const newMethods = new Map<string, FunctionType>();
    for (const [methodName, methodType] of base.methods) {
      newMethods.set(methodName, substituteFunctionType(methodType, subs));
    }

    return {
      kind: TypeKind.Struct,
      name: mangledName,
      fields: newFields,
      methods: newMethods,
      isUnsafe: base.isUnsafe,
      genericParams: [],
    };
  }

  /** Substitute type parameters in a type. */
  substituteType(type: Type, subs: Map<string, Type>): Type {
    return substituteTypeGeneric(type, subs);
  }

  private addError(message: string, span: Span): void {
    this.diagnostics.push({ message, span });
  }
}
