/**
 * Type-checks struct and unsafe struct declarations.  Lifecycle hook
 * auto-generation (`__destroy` / `__oncopy`) is delegated to the
 * Lifecycle module (`src/lifecycle/`); this checker keeps a thin shim
 * that mirrors decisions back onto `StructType.methods` so existing
 * type-check call sites that look up `s.__destroy()` keep working.
 * The shim is removed in PR 4 of the migration plan
 * (`docs/design/lifecycle-module.md` §7).
 */

import type { Declaration, FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes";
import type { Lifecycle } from "../lifecycle";
import type { Checker } from "./checker";
import { typeSymbol } from "./symbols";
import type { FunctionType, StructType } from "./types";
import { functionType, isPtrType, TypeKind, VOID_TYPE } from "./types";

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
   * Transition shim: while the migration is underway (PRs 1-3 of the
   * plan in `docs/design/lifecycle-module.md` §7), we mirror each
   * decision back onto `structType.methods` so type-check call sites
   * that reference `s.__destroy()` / `s.__oncopy()` keep resolving via
   * the type table. PR 4 replaces those lookups with Lifecycle
   * queries and the mirror disappears.
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
      // Mirror the decision onto the type table so the rest of the
      // checker (and KIR lowering, until PR 4) can keep looking it up
      // via `structType.methods`. The exact FunctionType shape matches
      // the historical pass-1.5 output so behaviour is preserved.
      if (arm === "destroy") {
        const destroyType = functionType(
          [{ name: "self", type: structType, isReadonly: false }],
          VOID_TYPE,
          [],
          [],
          false
        );
        structType.methods.set("__destroy", destroyType);
        structType.autoDestroy = true;
      } else {
        const oncopyType = functionType(
          [{ name: "self", type: structType, isReadonly: false }],
          structType,
          [],
          [],
          false
        );
        structType.methods.set("__oncopy", oncopyType);
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
          this.checker.error(
            `struct '${decl.name}' cannot have pointer field '${field.name}'; use 'unsafe struct' for pointer fields`,
            field.span
          );
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
      if (method.params.length !== 1) {
        this.checker.error(
          `lifecycle hook '${method.name}' must take exactly 1 parameter ('self: ref ${decl.name}')`,
          method.span
        );
        continue;
      }
      const selfParam = method.params[0];
      if (!selfParam) continue;
      if (selfParam.name !== "self") {
        this.checker.error(
          `lifecycle hook '${method.name}' first parameter must be named 'self'`,
          method.span
        );
      }
      const selfType = this.checker.resolveType(selfParam.typeAnnotation);
      const isRefSelf =
        selfType.kind === TypeKind.Ptr && (selfType as { isRef?: boolean }).isRef === true;
      if (!isRefSelf) {
        this.checker.error(
          `lifecycle hook '${method.name}' must take 'self: ref ${decl.name}'`,
          method.span
        );
      }
      if (method.returnType) {
        const retType = this.checker.resolveType(method.returnType);
        if (retType.kind !== TypeKind.Void) {
          this.checker.error(`lifecycle hook '${method.name}' must return void`, method.span);
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
