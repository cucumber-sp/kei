/**
 * Type-checks struct and unsafe struct declarations.  Lifecycle hook
 * auto-generation (`__destroy` / `__oncopy`) is delegated to the
 * Lifecycle module (`src/lifecycle/`); this checker only kicks off
 * registration and the fixed-point decide pass, and flips the
 * `autoDestroy` / `autoOncopy` flags on the struct type so KIR
 * synthesis can find the structs that need bodies emitted.
 */

import type { Declaration, FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes";
import type { Lifecycle } from "../lifecycle";
import type { Checker } from "./checker";
import { typeSymbol } from "./symbols";
import type { FunctionType, StructType } from "./types";
import { isPtrType, TypeKind } from "./types";

export class StructChecker {
  private checker: Checker;
  private lifecycle: Lifecycle;

  constructor(checker: Checker, lifecycle: Lifecycle) {
    this.checker = checker;
    this.lifecycle = lifecycle;
  }

  // ─── Registration (Pass 1) ──────────────────────────────────────────────

  registerStruct(
    decl: StructDecl | UnsafeStructDecl,
    isUnsafe: boolean,
    checkDuplicateTypeParams: (
      params: string[],
      declName: string,
      span: { start: number; end: number }
    ) => void,
    buildFunctionType: (decl: FunctionDecl) => FunctionType
  ): void {
    // Check for duplicate type parameters
    checkDuplicateTypeParams(decl.genericParams, decl.name, decl.span);

    // Create the struct type first with empty fields/methods so self-references work
    const structType: StructType = {
      kind: TypeKind.Struct,
      name: decl.name,
      fields: new Map(),
      methods: new Map(),
      isUnsafe,
      genericParams: decl.genericParams,
      modulePrefix: this.checker.modulePrefix,
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
    const readonlyFields = new Set<string>();
    for (const field of decl.fields) {
      if (fieldNames.has(field.name)) {
        this.checker.error(`duplicate field '${field.name}' in struct '${decl.name}'`, field.span);
        continue;
      }
      fieldNames.add(field.name);
      const fieldType = this.checker.resolveType(field.typeAnnotation);
      structType.fields.set(field.name, fieldType);
      if (field.isReadonly) readonlyFields.add(field.name);
    }
    if (readonlyFields.size > 0) structType.readonlyFields = readonlyFields;

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
      const methodType = buildFunctionType(method);
      structType.methods.set(method.name, methodType);
    }

    if (decl.genericParams.length > 0) {
      this.checker.popScope();
    }
  }

  // ─── Lifecycle decision (Pass 1.5) ──────────────────────────────────────

  /**
   * After all structs are registered (pass 1), delegate the auto-generation
   * decision for `__destroy` / `__oncopy` to the Lifecycle module. The
   * module owns a `Map<StructType, LifecycleDecision>` and runs a
   * fixed-point iteration over the registered structs to handle nested
   * structs (struct A has field of struct B which has a string field).
   *
   * The arm callback only flips the `autoDestroy` / `autoOncopy` flags on
   * the struct type so later passes (KIR lowering's pre-pass over
   * `CheckResult.lifecycle.autoDestroyStructs`) know which structs need
   * synthesised hook bodies. Hook *presence* queries go through
   * `lifecycle.hasDestroy` / `lifecycle.hasOncopy` directly — no
   * type-table mirror is maintained.
   */
  runLifecycleDecide(declarations: Declaration[]): void {
    const structDecls = declarations.filter(
      (d): d is StructDecl | UnsafeStructDecl =>
        d.kind === "StructDecl" || d.kind === "UnsafeStructDecl"
    );

    // Register every concrete struct (generics are skipped inside the
    // module — they're handled at monomorphization time).
    for (const decl of structDecls) {
      const typeSym = this.checker.currentScope.lookupType(decl.name);
      if (!typeSym || typeSym.kind !== "type" || typeSym.type.kind !== TypeKind.Struct) continue;
      this.lifecycle.register(typeSym.type);
    }

    this.lifecycle.runFixedPoint((structType, arm) => {
      if (arm === "destroy") {
        structType.autoDestroy = true;
      } else {
        structType.autoOncopy = true;
      }
    });
  }

  // ─── Full Checking (Pass 2) ─────────────────────────────────────────────

  checkStruct(decl: StructDecl | UnsafeStructDecl, isUnsafe: boolean): void {
    // Skip body checking for generic structs — methods are checked when instantiated
    if (decl.genericParams.length > 0) return;

    // Regular structs cannot have ptr<T> fields — only unsafe struct allows them
    if (!isUnsafe) {
      for (const field of decl.fields) {
        const ft = this.checker.resolveType(field.typeAnnotation);
        if (isPtrType(ft)) {
          this.checker.unsafeStructFieldRule({
            span: field.span,
            structName: decl.name,
            fieldName: field.name,
            message: `struct '${decl.name}' cannot have pointer field '${field.name}'; use 'unsafe struct' for pointer fields`,
          });
        }
      }
    }

    // Check unsafe struct lifecycle rules
    if (isUnsafe) {
      const hasPtrField = decl.fields.some((f) => {
        const ft = this.checker.resolveType(f.typeAnnotation);
        return isPtrType(ft);
      });

      if (hasPtrField) {
        const hasDestroy = decl.methods.some((m) => m.name === "__destroy");
        const hasOncopy = decl.methods.some((m) => m.name === "__oncopy");

        if (!hasDestroy || !hasOncopy) {
          const declLoc = this.checker.spanToLocation(decl.span);
          if (!hasDestroy) {
            this.checker.diag.unsafeStructMissingDestroy({
              span: declLoc,
              structName: decl.name,
            });
          }
          if (!hasOncopy) {
            this.checker.diag.unsafeStructMissingOncopy({
              span: declLoc,
              structName: decl.name,
            });
          }
        }
      }
    }

    // Validate lifecycle hook signatures.
    //
    // Both `__destroy` and `__oncopy` take `self: ref T` and return void.
    // Mutate-the-slot-in-place is the contract: bitwise copy fires the
    // hook on the destination, and the destination is the slot we want
    // the hook to operate on. By-value `self: T` would copy the struct
    // before the hook runs, leaving the actual slot untouched; raw
    // `*T` lets safe code observe an unbound pointer. `ref T` is the
    // only spelling that matches the C-emitted prototype.
    for (const method of decl.methods) {
      if (method.name !== "__destroy" && method.name !== "__oncopy") continue;
      const methodLoc = this.checker.spanToLocation(method.span);
      if (method.params.length !== 1) {
        this.checker.diag.invalidLifecycleSignature({
          span: methodLoc,
          hookName: method.name,
          structName: decl.name,
          reason: "wrong-arity",
        });
        continue;
      }
      const selfParam = method.params[0];
      if (!selfParam) continue;
      if (selfParam.name !== "self") {
        this.checker.diag.invalidLifecycleSignature({
          span: methodLoc,
          hookName: method.name,
          structName: decl.name,
          reason: "first-param-not-self",
        });
      }
      const selfType = this.checker.resolveType(selfParam.typeAnnotation);
      const isRefSelf =
        selfType.kind === TypeKind.Ptr && (selfType as { isRef?: boolean }).isRef === true;
      if (!isRefSelf) {
        this.checker.diag.lifecycleHookSelfMismatch({
          span: methodLoc,
          hookName: method.name,
          structName: decl.name,
        });
      }
      if (method.returnType) {
        const retType = this.checker.resolveType(method.returnType);
        if (retType.kind !== TypeKind.Void) {
          this.checker.diag.lifecycleReturnTypeWrong({
            span: methodLoc,
            hookName: method.name,
          });
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
      this.checker.defineVariable(param.name, paramType, !param.isReadonly, false, param.span);
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
}
