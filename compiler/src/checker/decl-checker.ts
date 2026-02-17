/**
 * Type-checks declarations (fn, struct, enum, etc.).
 */

import type {
  Declaration,
  EnumDecl,
  ExternFunctionDecl,
  FunctionDecl,
  ImportDecl,
  StaticDecl,
  StructDecl,
  TypeAlias,
  UnsafeStructDecl,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { functionSymbol, moduleSymbol, typeSymbol, variableSymbol } from "./symbols.ts";
import type {
  EnumVariantInfo,
  FunctionType,
  ModuleType,
  ParamInfo,
  StructType,
  Type,
} from "./types";
import {
  ERROR_TYPE,
  functionType,
  I32_TYPE,
  isAssignableTo,
  isErrorType,
  isIntegerType,
  isPtrType,
  TypeKind,
  typeToString,
  VOID_TYPE,
} from "./types";

export class DeclarationChecker {
  private checker: Checker;

  constructor(checker: Checker) {
    this.checker = checker;
  }

  /**
   * First pass: register all top-level declarations in the global scope.
   * This enables forward references between types and functions.
   */
  registerDeclaration(decl: Declaration): void {
    switch (decl.kind) {
      case "FunctionDecl":
        this.registerFunction(decl);
        break;
      case "ExternFunctionDecl":
        this.registerExternFunction(decl);
        break;
      case "StructDecl":
        this.registerStruct(decl, false);
        break;
      case "UnsafeStructDecl":
        this.registerStruct(decl, true);
        break;
      case "EnumDecl":
        this.registerEnum(decl);
        break;
      case "TypeAlias":
        this.registerTypeAlias(decl);
        break;
      case "StaticDecl":
        this.registerStatic(decl);
        break;
      case "ImportDecl":
        this.registerImport(decl);
        break;
    }
  }

  /** Second pass: fully check declarations. */
  checkDeclaration(decl: Declaration): void {
    switch (decl.kind) {
      case "FunctionDecl":
        this.checkFunction(decl);
        break;
      case "ExternFunctionDecl":
        // Already registered, nothing else to check
        break;
      case "StructDecl":
        this.checkStruct(decl, false);
        break;
      case "UnsafeStructDecl":
        this.checkStruct(decl, true);
        break;
      case "EnumDecl":
        this.checkEnum(decl);
        break;
      case "TypeAlias":
        // Already registered
        break;
      case "StaticDecl":
        this.checkStaticDecl(decl);
        break;
      case "ImportDecl":
        // Already registered
        break;
    }
  }

  // ─── Registration (Pass 1) ──────────────────────────────────────────────

  private registerFunction(decl: FunctionDecl): void {
    const funcType = this.buildFunctionType(decl);
    const sym = functionSymbol(decl.name, funcType, false, decl);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(
        `duplicate declaration '${decl.name}' (same parameter signature)`,
        decl.span
      );
    }
  }

  private registerExternFunction(decl: ExternFunctionDecl): void {
    const params: ParamInfo[] = decl.params.map((p) => ({
      name: p.name,
      type: this.checker.resolveType(p.typeAnnotation),
      isMut: p.isMut,
      isMove: p.isMove,
    }));

    const returnType = decl.returnType ? this.checker.resolveType(decl.returnType) : VOID_TYPE;

    const funcType = functionType(params, returnType, [], [], true);
    const sym = functionSymbol(decl.name, funcType, true);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
    }
  }

  private registerStruct(decl: StructDecl | UnsafeStructDecl, isUnsafe: boolean): void {
    // Check for duplicate type parameters
    this.checkDuplicateTypeParams(decl.genericParams, decl.name, decl.span);

    // Create the struct type first with empty fields/methods so self-references work
    const structType: StructType = {
      kind: TypeKind.Struct,
      name: decl.name,
      fields: new Map(),
      methods: new Map(),
      isUnsafe,
      genericParams: decl.genericParams,
    };

    // Register early so self-referencing types in methods/fields resolve
    const sym = typeSymbol(decl.name, structType, decl);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
      return;
    }

    // Register generic type params temporarily in scope for field/method resolution
    if (decl.genericParams.length > 0) {
      this.checker.pushScope({});
      for (const gp of decl.genericParams) {
        this.checker.currentScope.define(typeSymbol(gp, { kind: TypeKind.TypeParam, name: gp }));
      }
    }

    // Now resolve fields
    const fieldNames = new Set<string>();
    for (const field of decl.fields) {
      if (fieldNames.has(field.name)) {
        this.checker.error(`duplicate field '${field.name}' in struct '${decl.name}'`, field.span);
        continue;
      }
      fieldNames.add(field.name);
      const fieldType = this.checker.resolveType(field.typeAnnotation);
      structType.fields.set(field.name, fieldType);
    }

    // Now resolve methods (self: StructName will now resolve)
    const seenMethods = new Set<string>();
    for (const method of decl.methods) {
      if (seenMethods.has(method.name)) {
        this.checker.error(
          `duplicate method '${method.name}' in struct '${decl.name}'`,
          method.span
        );
        continue;
      }
      seenMethods.add(method.name);
      const methodType = this.buildFunctionType(method);
      structType.methods.set(method.name, methodType);
    }

    if (decl.genericParams.length > 0) {
      this.checker.popScope();
    }
  }

  private registerEnum(decl: EnumDecl): void {
    const baseType = decl.baseType ? this.checker.resolveType(decl.baseType) : null;

    // Check for duplicate variants
    const seenVariants = new Set<string>();
    for (const v of decl.variants) {
      if (seenVariants.has(v.name)) {
        this.checker.error(`duplicate variant '${v.name}' in enum '${decl.name}'`, v.span);
      }
      seenVariants.add(v.name);
    }

    const variants: EnumVariantInfo[] = decl.variants.map((v) => ({
      name: v.name,
      fields: v.fields.map((f) => ({
        name: f.name,
        type: this.checker.resolveType(f.typeAnnotation),
      })),
      value: v.value && v.value.kind === "IntLiteral" ? v.value.value : null,
    }));

    const enumType = {
      kind: TypeKind.Enum as const,
      name: decl.name,
      baseType,
      variants,
    };

    const sym = typeSymbol(decl.name, enumType, decl);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
      return;
    }
  }

  private registerTypeAlias(decl: TypeAlias): void {
    const resolvedType = this.checker.resolveType(decl.typeValue);
    const sym = typeSymbol(decl.name, resolvedType);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
    }
  }

  private registerStatic(decl: StaticDecl): void {
    // Static type will be checked in pass 2, register with placeholder
    const initType = decl.typeAnnotation
      ? this.checker.resolveType(decl.typeAnnotation)
      : this.inferStaticType(decl);

    const sym = variableSymbol(decl.name, initType, false, true);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
    }
  }

  private registerImport(decl: ImportDecl): void {
    const moduleExports = this.checker.getModuleExports();
    const exportedSymbols = moduleExports.get(decl.path);

    if (!exportedSymbols) {
      // No module exports available — may be single-file mode or unresolved
      // Register placeholders for selective imports (backward compat)
      if (decl.items.length > 0) {
        for (const item of decl.items) {
          this.checker.currentScope.define(
            typeSymbol(item, {
              kind: TypeKind.Struct,
              name: item,
              fields: new Map(),
              methods: new Map(),
              isUnsafe: false,
              genericParams: [],
            })
          );
        }
      }
      return;
    }

    if (decl.items.length > 0) {
      // Selective import: import { add, multiply } from math;
      // Bring only the named items directly into scope
      for (const item of decl.items) {
        const sym = exportedSymbols.get(item);
        if (sym) {
          this.checker.currentScope.define(sym);
        } else {
          this.checker.error(`'${item}' is not exported by module '${decl.path}'`, decl.span);
        }
      }
    } else {
      // Whole-module import: import math;
      // Register as a module symbol for qualified access: math.add()
      const modExports = new Map<string, Type>();
      for (const [name, sym] of exportedSymbols) {
        modExports.set(name, sym.type);
      }

      // Use the last part of the dotted path as the local name
      const parts = decl.path.split(".");
      const localName = parts[parts.length - 1];

      const modType: ModuleType = {
        kind: TypeKind.Module,
        name: decl.path,
        exports: modExports,
      };

      this.checker.currentScope.define(moduleSymbol(localName, modType, exportedSymbols));
    }
  }

  // ─── Full Checking (Pass 2) ─────────────────────────────────────────────

  private checkFunction(decl: FunctionDecl): void {
    // Skip body checking for generic functions — they are checked when instantiated
    if (decl.genericParams.length > 0) return;

    const funcSym = this.checker.currentScope.lookupFunction(decl.name);
    if (!funcSym || funcSym.kind !== "function") return;

    // Find the overload matching this specific declaration
    const overload = funcSym.overloads.find((o) => o.declaration === decl);
    const funcType = overload ? overload.type : funcSym.type;

    // Create function scope
    this.checker.pushScope({ functionContext: funcType });

    // Add params to scope
    for (const param of decl.params) {
      const paramType = this.checker.resolveType(param.typeAnnotation);
      this.checker.defineVariable(param.name, paramType, param.isMut, false, param.span);
    }

    // Check body
    let returns = false;
    for (const stmt of decl.body.statements) {
      if (returns) {
        this.checker.warning("unreachable code after return", stmt.span);
        break;
      }
      returns = this.checker.checkStatement(stmt);
    }

    // Check all code paths return
    if (funcType.returnType.kind !== TypeKind.Void && !returns) {
      this.checker.error(`function '${decl.name}' does not return a value on all paths`, decl.span);
    }

    this.checker.popScope();
  }

  private checkStruct(decl: StructDecl | UnsafeStructDecl, isUnsafe: boolean): void {
    // Skip body checking for generic structs — methods are checked when instantiated
    if (decl.genericParams.length > 0) return;

    // Check unsafe struct lifecycle rules
    if (isUnsafe) {
      const hasPtrField = decl.fields.some((f) => {
        const ft = this.checker.resolveType(f.typeAnnotation);
        return isPtrType(ft);
      });

      if (hasPtrField) {
        const hasDestroy = decl.methods.some((m) => m.name === "__destroy");
        const hasOncopy = decl.methods.some((m) => m.name === "__oncopy");

        if (!hasDestroy) {
          this.checker.error(
            `unsafe struct '${decl.name}' with ptr<T> fields must define '__destroy'`,
            decl.span
          );
        }
        if (!hasOncopy) {
          this.checker.error(
            `unsafe struct '${decl.name}' with ptr<T> fields must define '__oncopy'`,
            decl.span
          );
        }
      }
    }

    // Validate lifecycle hook signatures
    for (const method of decl.methods) {
      if (method.name === "__destroy") {
        if (method.params.length !== 1) {
          this.checker.error(
            `lifecycle hook '__destroy' must take exactly 1 parameter`,
            method.span
          );
        }
        if (method.returnType) {
          const retType = this.checker.resolveType(method.returnType);
          if (retType.kind !== TypeKind.Void) {
            this.checker.error(`lifecycle hook '__destroy' must return void`, method.span);
          }
        }
      } else if (method.name === "__oncopy") {
        if (method.params.length >= 1 && method.params[0].name !== "self") {
          this.checker.error(
            `lifecycle hook '__oncopy' first parameter must be named 'self'`,
            method.span
          );
        }
      }
    }

    // Check methods
    for (const method of decl.methods) {
      this.checkStructMethod(decl, method);
    }
  }

  private checkStructMethod(structDecl: StructDecl | UnsafeStructDecl, method: FunctionDecl): void {
    // Look up the struct's type symbol to get the StructType
    const typeSym = this.checker.currentScope.lookupType(structDecl.name);
    if (!typeSym || typeSym.kind !== "type" || typeSym.type.kind !== TypeKind.Struct) return;

    const structType = typeSym.type;
    const methodFuncType = structType.methods.get(method.name);
    if (!methodFuncType) return;

    // Create method scope
    this.checker.pushScope({ functionContext: methodFuncType });

    // Add generic type params
    for (const gp of structDecl.genericParams) {
      this.checker.currentScope.define(typeSymbol(gp, { kind: TypeKind.TypeParam, name: gp }));
    }
    for (const gp of method.genericParams) {
      this.checker.currentScope.define(typeSymbol(gp, { kind: TypeKind.TypeParam, name: gp }));
    }

    // Add params to scope
    for (const param of method.params) {
      const paramType = this.checker.resolveType(param.typeAnnotation);
      this.checker.defineVariable(param.name, paramType, param.isMut, false, param.span);
    }

    // Check body
    let returns = false;
    for (const stmt of method.body.statements) {
      if (returns) {
        this.checker.warning("unreachable code after return", stmt.span);
        break;
      }
      returns = this.checker.checkStatement(stmt);
    }

    if (methodFuncType.returnType.kind !== TypeKind.Void && !returns) {
      this.checker.error(
        `method '${method.name}' does not return a value on all paths`,
        method.span
      );
    }

    this.checker.popScope();
  }

  private checkEnum(decl: EnumDecl): void {
    if (decl.baseType) {
      const baseType = this.checker.resolveType(decl.baseType);
      // Check variant values match base type
      for (const variant of decl.variants) {
        if (variant.value) {
          const valueType = this.checker.checkExpression(variant.value);
          if (!isErrorType(valueType) && !isErrorType(baseType)) {
            // Allow integer literal values for any integer base type
            // (e.g., literal 0 is i32 but enum base is u8)
            const bothIntegers = isIntegerType(valueType) && isIntegerType(baseType);
            if (!bothIntegers && !isAssignableTo(valueType, baseType)) {
              this.checker.error(
                `enum variant '${variant.name}' value type '${typeToString(valueType)}' does not match base type '${typeToString(baseType)}'`,
                variant.span
              );
            }
          }
        }
      }
    }
  }

  private checkStaticDecl(decl: StaticDecl): void {
    const initType = this.checker.checkExpression(decl.initializer);

    if (decl.typeAnnotation) {
      const annotatedType = this.checker.resolveType(decl.typeAnnotation);
      if (
        !isErrorType(initType) &&
        !isErrorType(annotatedType) &&
        !isAssignableTo(initType, annotatedType)
      ) {
        this.checker.error(
          `type mismatch: expected '${typeToString(annotatedType)}', got '${typeToString(initType)}'`,
          decl.span
        );
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private buildFunctionType(decl: FunctionDecl): FunctionType {
    // Check for duplicate type parameters
    this.checkDuplicateTypeParams(decl.genericParams, decl.name, decl.span);

    // Push generic type params into scope for resolving param/return types
    if (decl.genericParams.length > 0) {
      this.checker.pushScope({});
      for (const gp of decl.genericParams) {
        this.checker.currentScope.define(typeSymbol(gp, { kind: TypeKind.TypeParam, name: gp }));
      }
    }

    const params: ParamInfo[] = decl.params.map((p) => ({
      name: p.name,
      type: this.checker.resolveType(p.typeAnnotation),
      isMut: p.isMut,
      isMove: p.isMove,
    }));

    const returnType = decl.returnType ? this.checker.resolveType(decl.returnType) : VOID_TYPE;

    const throwsTypes = decl.throwsTypes.map((t) => this.checker.resolveType(t));

    if (decl.genericParams.length > 0) {
      this.checker.popScope();
    }

    return functionType(params, returnType, throwsTypes, decl.genericParams, false);
  }

  /** Report an error if the same type parameter name appears more than once. */
  private checkDuplicateTypeParams(
    params: string[],
    declName: string,
    span: { start: number; end: number }
  ): void {
    const seen = new Set<string>();
    for (const gp of params) {
      if (seen.has(gp)) {
        this.checker.error(`duplicate type parameter '${gp}' in '${declName}'`, span);
      }
      seen.add(gp);
    }
  }

  private inferStaticType(decl: StaticDecl): Type {
    // Simple inference for static: check literal type
    switch (decl.initializer.kind) {
      case "IntLiteral":
        return I32_TYPE;
      case "FloatLiteral":
        return { kind: TypeKind.Float, bits: 64 };
      case "StringLiteral":
        return { kind: TypeKind.String };
      case "BoolLiteral":
        return { kind: TypeKind.Bool };
      default:
        return ERROR_TYPE;
    }
  }
}
