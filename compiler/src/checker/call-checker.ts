/**
 * Type-checks function call expressions: regular calls, overloaded calls,
 * generic function calls (explicit and inferred type args), module-qualified
 * calls, static method calls, and instance method calls.
 */

import type { CallExpr, Expression, FunctionDecl } from "../ast/nodes";
import type { Checker } from "./checker";
import {
  mangleGenericName,
  substituteFunctionType,
  substituteType as substituteTypeGeneric,
} from "./generics";
import { extractTypeParamSubs } from "./literal-checker";
import type { FunctionOverload } from "./symbols";
import { SymbolKind } from "./symbols";
import type { EnumType, FunctionType, Type } from "./types";
import {
  ERROR_TYPE,
  extractLiteralInfo,
  isAssignableTo,
  isErrorType,
  isLiteralAssignableTo,
  isPtrType,
  ptrType,
  TypeKind,
  typesEqual,
  typeToString,
  USIZE_TYPE,
  VOID_TYPE,
} from "./types";

/** Special case: sizeof(Type) */
function checkSizeofCall(checker: Checker, expr: CallExpr): Type | null {
  if (expr.callee.kind !== "Identifier" || expr.callee.name !== "sizeof") return null;

  if (expr.args.length !== 1) {
    checker.error("'sizeof' expects exactly 1 argument", expr.span);
    return ERROR_TYPE;
  }
  const arg = expr.args[0];
  if (!arg) return ERROR_TYPE;
  if (arg.kind === "Identifier") {
    // Try a regular value/type lookup first; fall back to type-only
    // resolution so `sizeof(T)` inside a generic body works (the
    // substitution map is set up during the per-instantiation body
    // check and {@link resolveType} consults it).
    const sym = checker.currentScope.lookup(arg.name);
    if (!sym) {
      const typeNode = { kind: "NamedType" as const, name: arg.name, span: arg.span };
      const t = checker.resolveType(typeNode);
      if (t.kind === "error") {
        checker.error(`undeclared type '${arg.name}'`, arg.span);
        return ERROR_TYPE;
      }
    }
  } else {
    checker.checkExpression(arg);
  }
  return USIZE_TYPE;
}

/**
 * Special case: `onCopy(p)` / `onDestroy(p)` — fire the pointee type's
 * `__oncopy(self: ref T)` / `__destroy(self: ref T)` hook through a raw
 * pointer. Both are unsafe-only and require the pointee to be a struct
 * with the corresponding hook defined.
 */
function checkLifecycleHookBuiltin(checker: Checker, expr: CallExpr): Type | null {
  if (expr.callee.kind !== "Identifier") return null;
  const name = expr.callee.name;
  if (name !== "onCopy" && name !== "onDestroy") return null;
  // Only treat the call as a builtin when the name resolves to the
  // builtin function symbol — user code that shadows the name with a
  // local function falls through to the regular call path.
  const sym = checker.currentScope.lookup(name);
  if (!sym) return null;

  if (!checker.currentScope.isInsideUnsafe()) {
    checker.error(`'${name}' requires unsafe`, expr.span);
    return ERROR_TYPE;
  }

  if (expr.args.length !== 1) {
    checker.error(`'${name}' expects exactly 1 argument`, expr.span);
    return ERROR_TYPE;
  }
  const arg = expr.args[0];
  if (!arg) return ERROR_TYPE;
  const argType = checker.checkExpression(arg);
  if (isErrorType(argType)) return ERROR_TYPE;

  if (!isPtrType(argType)) {
    checker.error(`'${name}' expects a '*T' argument, got '${typeToString(argType)}'`, expr.span);
    return ERROR_TYPE;
  }
  const pointee = argType.pointee;
  if (pointee.kind !== "struct") {
    checker.error(
      `'${name}' expects a pointer to a struct, got '${typeToString(argType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }
  const hookName = name === "onCopy" ? "__oncopy" : "__destroy";
  if (!pointee.methods.has(hookName)) {
    checker.error(
      `type '${pointee.name}' has no '${hookName}' hook for '${name}' to call`,
      expr.span
    );
    return ERROR_TYPE;
  }
  return VOID_TYPE;
}

/** Special case: alloc<T>(count) and free(ptr) — require unsafe */
function checkBuiltinAllocFree(checker: Checker, expr: CallExpr): Type | null {
  if (expr.callee.kind !== "Identifier") return null;
  const name = expr.callee.name;
  if ((name !== "alloc" && name !== "free") || !checker.currentScope.lookup(name)) return null;

  if (!checker.currentScope.isInsideUnsafe()) {
    checker.error(`cannot call '${name}' outside unsafe block`, expr.span);
    return ERROR_TYPE;
  }

  if (name === "alloc") {
    if (expr.args.length !== 1) {
      checker.error("'alloc' expects exactly 1 argument", expr.span);
      return ERROR_TYPE;
    }
    const allocArg = expr.args[0];
    if (!allocArg) return ERROR_TYPE;
    const argType = checker.checkExpression(allocArg);
    if (isErrorType(argType)) return ERROR_TYPE;

    // alloc<T>(count) returns ptr<T>; alloc(count) returns ptr<void>
    if (expr.typeArgs.length > 1) {
      checker.error("'alloc' expects at most 1 type argument", expr.span);
      return ERROR_TYPE;
    }
    const typeArg = expr.typeArgs[0];
    if (typeArg) {
      const elementType = checker.resolveType(typeArg);
      if (isErrorType(elementType)) return ERROR_TYPE;
      return ptrType(elementType);
    }
    return ptrType(VOID_TYPE);
  }

  // free
  if (expr.args.length !== 1) {
    checker.error("'free' expects exactly 1 argument", expr.span);
    return ERROR_TYPE;
  }
  const freeArg = expr.args[0];
  if (!freeArg) return ERROR_TYPE;
  const argType = checker.checkExpression(freeArg);
  if (!isErrorType(argType) && !isPtrType(argType)) {
    checker.error(`'free' expects a pointer argument, got '${typeToString(argType)}'`, expr.span);
    return ERROR_TYPE;
  }
  return VOID_TYPE;
}

export function checkCallExpression(checker: Checker, expr: CallExpr): Type {
  // Special case: sizeof(Type)
  const sizeofResult = checkSizeofCall(checker, expr);
  if (sizeofResult !== null) return sizeofResult;

  // Special case: onCopy / onDestroy lifecycle hook builtins
  const lifecycleResult = checkLifecycleHookBuiltin(checker, expr);
  if (lifecycleResult !== null) return lifecycleResult;

  // Special case: alloc<T>(count) and free(ptr) — require unsafe
  const builtinResult = checkBuiltinAllocFree(checker, expr);
  if (builtinResult !== null) return builtinResult;

  // Check for generic function call with explicit type args: func<T>(args)
  if (expr.callee.kind === "Identifier" && expr.typeArgs.length > 0) {
    return checkGenericFunctionCall(checker, expr);
  }

  // Check for generic function call with inferred type args
  if (expr.callee.kind === "Identifier") {
    const sym = checker.currentScope.lookup(expr.callee.name);
    if (sym && sym.kind === SymbolKind.Function) {
      // Check if any overload is generic
      const genericOverload = sym.overloads.find((o) => o.type.genericParams.length > 0);
      if (genericOverload && sym.overloads.length === 1) {
        return checkGenericFunctionCallInferred(checker, genericOverload.type, expr);
      }
    }
  }

  // Check for overloaded function call by identifier
  if (expr.callee.kind === "Identifier") {
    const sym = checker.currentScope.lookup(expr.callee.name);
    if (sym && sym.kind === SymbolKind.Function && sym.overloads.length > 1) {
      return resolveOverloadedCall(checker, sym.overloads, expr);
    }
  }

  // Check for enum variant construction: Enum.Variant(args) or
  // Enum<TypeArgs>.Variant(args) for a generic enum.
  if (expr.callee.kind === "MemberExpr") {
    const memberExpr = expr.callee;
    if (memberExpr.object.kind === "Identifier") {
      const enumSym = checker.currentScope.lookupType(memberExpr.object.name);
      if (enumSym && enumSym.kind === SymbolKind.Type && enumSym.type.kind === TypeKind.Enum) {
        const baseEnum = enumSym.type;
        const variant = baseEnum.variants.find((v) => v.name === memberExpr.property);
        if (variant) {
          // For generic enums (`Optional<i32>.Some(7)`), instantiate the
          // enum with the supplied type args before typechecking the
          // payload arguments. The instantiation substitutes the variant
          // field types from `T` to the concrete type and produces a
          // distinct, monomorphized EnumType whose name encodes the
          // type args (e.g. `Optional_i32`).
          let enumType = baseEnum;
          if (baseEnum.genericParams.length > 0) {
            if (expr.typeArgs.length === 0) {
              checker.error(
                `generic enum '${baseEnum.name}' requires type arguments (e.g. '${baseEnum.name}<...>.${variant.name}')`,
                expr.span
              );
              return ERROR_TYPE;
            }
            if (expr.typeArgs.length !== baseEnum.genericParams.length) {
              checker.error(
                `enum '${baseEnum.name}' expects ${baseEnum.genericParams.length} type argument(s), got ${expr.typeArgs.length}`,
                expr.span
              );
              return ERROR_TYPE;
            }
            const inst = checker.instantiateGenericEnum(baseEnum, expr.typeArgs);
            if (isErrorType(inst)) return ERROR_TYPE;
            enumType = inst as EnumType;
          } else if (expr.typeArgs.length > 0) {
            checker.error(
              `enum '${baseEnum.name}' is not generic but was called with ${expr.typeArgs.length} type argument(s)`,
              expr.span
            );
            return ERROR_TYPE;
          }
          const concreteVariant =
            enumType.variants.find((v) => v.name === memberExpr.property) ?? variant;

          if (concreteVariant.fields.length === 0) {
            checker.error(
              `enum variant '${enumType.name}.${concreteVariant.name}' has no fields — use '${enumType.name}.${concreteVariant.name}' without call syntax`,
              expr.span
            );
            return ERROR_TYPE;
          }
          // Check argument count
          if (expr.args.length !== concreteVariant.fields.length) {
            checker.error(
              `enum variant '${enumType.name}.${concreteVariant.name}' expects ${concreteVariant.fields.length} argument(s), got ${expr.args.length}`,
              expr.span
            );
            return ERROR_TYPE;
          }
          // Check argument types
          for (let i = 0; i < expr.args.length; i++) {
            const arg = expr.args[i];
            if (!arg) continue;
            const argType = checker.checkExpression(arg);
            const field = concreteVariant.fields[i];
            if (field && !isErrorType(argType) && !isAssignableTo(argType, field.type)) {
              const litInfo = extractLiteralInfo(arg);
              const isLiteralOk =
                litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, field.type);
              if (!isLiteralOk) {
                checker.error(
                  `argument '${field.name}': expected '${typeToString(field.type)}', got '${typeToString(argType)}'`,
                  arg.span
                );
              }
            }
          }
          // Store the enum type on the callee so lowerer can detect this
          checker.setExprType(memberExpr.object, enumType);
          checker.setExprType(expr.callee, enumType);
          return enumType;
        }
        checker.error(`enum '${baseEnum.name}' has no variant '${memberExpr.property}'`, expr.span);
        return ERROR_TYPE;
      }
    }
  }

  // Check for module-qualified call or static method call: mod.func(args) or Type.method(args)
  if (expr.callee.kind === "MemberExpr") {
    const memberExpr = expr.callee;
    if (memberExpr.object.kind === "Identifier") {
      // Check module-qualified call: module.function(args)
      const modSym = checker.currentScope.lookup(memberExpr.object.name);
      if (modSym && modSym.kind === SymbolKind.Module) {
        // Store the module type in typeMap so the lowerer can detect module-qualified calls
        checker.setExprType(memberExpr.object, modSym.type);
        const exportedSym = modSym.symbols.get(memberExpr.property);
        if (exportedSym && exportedSym.kind === SymbolKind.Function) {
          // Handle overloaded module functions
          if (exportedSym.overloads.length > 1) {
            return resolveOverloadedCall(checker, exportedSym.overloads, expr);
          }
          checker.setExprType(expr.callee, exportedSym.type);
          return checkFunctionCallArgs(checker, exportedSym.type, expr.args, expr, false);
        }
        if (
          exportedSym &&
          exportedSym.kind === SymbolKind.Type &&
          exportedSym.type.kind === TypeKind.Struct
        ) {
          // Module-qualified static method: module.Struct.method() — handled below via normal MemberExpr flow
        }
        if (!exportedSym) {
          checker.error(
            `module '${modSym.name}' has no exported member '${memberExpr.property}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
      }

      // Check static method call: Type.method(args)  /  Type<TypeArgs>.method(args)
      const typeSym = checker.currentScope.lookupType(memberExpr.object.name);
      if (typeSym && typeSym.kind === SymbolKind.Type && typeSym.type.kind === TypeKind.Struct) {
        const structType = typeSym.type;
        const method = structType.methods.get(memberExpr.property);
        if (method) {
          // Mark this call so KIR lowering dispatches it without a self-arg.
          // The mangled struct name reflects the type-args (if any) so
          // calls into monomorphized generic structs land on the right
          // C function (e.g. `Shared_i32_wrap`).
          const baseName = structType.name;
          let mangledStructName = baseName;
          if (
            expr.typeArgs.length > 0 &&
            structType.genericParams.length === expr.typeArgs.length
          ) {
            const argSuffixes = expr.typeArgs
              .map((t) => checker.resolveType(t))
              .map((t) => {
                if (t.kind === "struct") return t.name;
                if (t.kind === "int") return `${t.signed ? "i" : "u"}${t.bits}`;
                if (t.kind === "float") return `f${t.bits}`;
                if (t.kind === "bool") return "bool";
                if (t.kind === "string") return "string";
                return "T";
              });
            mangledStructName = mangleGenericName(
              baseName,
              expr.typeArgs.map((t) => checker.resolveType(t))
            );
            void argSuffixes;
          }
          checker.staticMethodCalls.set(expr, {
            structName: baseName,
            mangledStructName,
          });
          // For `Type<TypeArgs>.method(args)` the parser stashes the
          // type-args on the outer CallExpr. Bind them to the struct's
          // generic parameters, substitute through the method's
          // signature so the body sees concrete types, and register
          // the monomorphization so KIR emits the instance + its
          // methods.
          let resolvedMethod = method;
          if (expr.typeArgs.length > 0 && structType.genericParams.length > 0) {
            if (expr.typeArgs.length !== structType.genericParams.length) {
              checker.error(
                `type '${structType.name}' expects ${structType.genericParams.length} type argument(s), got ${expr.typeArgs.length}`,
                expr.span
              );
              return ERROR_TYPE;
            }
            const subs = new Map<string, Type>();
            const resolvedArgs: Type[] = [];
            for (let i = 0; i < structType.genericParams.length; i++) {
              const paramName = structType.genericParams[i];
              const arg = expr.typeArgs[i];
              if (paramName && arg) {
                const resolved = checker.resolveType(arg);
                subs.set(paramName, resolved);
                resolvedArgs.push(resolved);
              }
            }
            resolvedMethod = substituteFunctionType(method, subs);
            const originalDecl =
              typeSym.declaration?.kind === "StructDecl" ||
              typeSym.declaration?.kind === "UnsafeStructDecl"
                ? typeSym.declaration
                : undefined;
            registerStaticCallMonomorphization(
              checker,
              structType,
              resolvedArgs,
              subs,
              originalDecl
            );
          }
          // Stash the resolved (substituted) FunctionType on the callee
          // MemberExpr so KIR lowering can match args against param types
          // and apply the auto-reference rule (T → ref T at the boundary).
          checker.setExprType(expr.callee, resolvedMethod);
          return checkFunctionCallArgs(checker, resolvedMethod, expr.args, expr, false);
        }
        checker.error(
          `type '${structType.name}' has no method '${memberExpr.property}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
    }
  }

  // Check if this is an instance method call: obj.method(args)
  const isInstanceMethodCall = expr.callee.kind === "MemberExpr";

  // Regular function / method call
  const calleeType = checker.checkExpression(expr.callee);
  if (isErrorType(calleeType)) return ERROR_TYPE;

  if (calleeType.kind === TypeKind.Function) {
    // Check extern fn requires unsafe
    if (calleeType.isExtern && !checker.currentScope.isInsideUnsafe()) {
      checker.error("cannot call extern function outside unsafe block", expr.span);
      return ERROR_TYPE;
    }

    // For instance method calls, skip the self parameter
    if (isInstanceMethodCall && calleeType.params.length > 0) {
      const firstParam = calleeType.params[0];
      if (firstParam && firstParam.name === "self") {
        return checkFunctionCallArgs(checker, calleeType, expr.args, expr, true);
      }
    }

    return checkFunctionCallArgs(checker, calleeType, expr.args, expr, false);
  }

  checker.error(`expression of type '${typeToString(calleeType)}' is not callable`, expr.span);
  return ERROR_TYPE;
}

/** Resolve an overloaded function call by matching argument types exactly. */
function resolveOverloadedCall(
  checker: Checker,
  overloads: FunctionOverload[],
  expr: CallExpr
): Type {
  // First, type-check all arguments
  const argTypes: Type[] = [];
  for (const arg of expr.args) {
    argTypes.push(checker.checkExpression(arg));
  }

  // If any arg is error type, bail early
  if (argTypes.some((t) => isErrorType(t))) return ERROR_TYPE;

  // Find exact matches: same arity and exact type match on each param
  const matches: FunctionOverload[] = [];
  for (const overload of overloads) {
    const params = overload.type.params;
    if (params.length !== argTypes.length) continue;

    let allMatch = true;
    for (let i = 0; i < params.length; i++) {
      const paramType = params[i]?.type;
      const argType = argTypes[i];
      if (!paramType || !argType || !typesEqual(paramType, argType)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) matches.push(overload);
  }

  if (matches.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: length === 1 check just above
    const matched = matches[0]!;
    checker.setExprType(expr.callee, matched.type);
    applyMoveParams(checker, expr, matched.type);
    if (matched.type.throwsTypes.length > 0) {
      checker.flagThrowsCall(expr, matched.type);
    }
    return matched.type.returnType;
  }

  if (matches.length > 1) {
    checker.error("ambiguous call — multiple overloads match", expr.span);
    return ERROR_TYPE;
  }

  // No exact match — try with assignability (widening + literal conversions)
  const wideMatches: FunctionOverload[] = [];
  for (const overload of overloads) {
    const params = overload.type.params;
    if (params.length !== argTypes.length) continue;

    let allAssignable = true;
    for (let i = 0; i < params.length; i++) {
      const paramType = params[i]?.type;
      const argType = argTypes[i];
      if (!paramType || !argType) {
        allAssignable = false;
        break;
      }
      if (!isAssignableTo(argType, paramType)) {
        // Check literal assignability
        const arg = expr.args[i];
        const litInfo = arg ? extractLiteralInfo(arg) : null;
        const isLiteralOk =
          litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
        if (!isLiteralOk) {
          allAssignable = false;
          break;
        }
      }
    }
    if (allAssignable) wideMatches.push(overload);
  }

  if (wideMatches.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: length === 1 check just above
    const matched = wideMatches[0]!;
    checker.setExprType(expr.callee, matched.type);
    applyMoveParams(checker, expr, matched.type);
    if (matched.type.throwsTypes.length > 0) {
      checker.flagThrowsCall(expr, matched.type);
    }
    return matched.type.returnType;
  }

  if (wideMatches.length > 1) {
    checker.error("ambiguous call — multiple overloads match", expr.span);
    return ERROR_TYPE;
  }

  // No match at all
  const argStr = argTypes.map((t) => typeToString(t)).join(", ");
  checker.error(`no matching overload for call with arguments (${argStr})`, expr.span);
  return ERROR_TYPE;
}

/**
 * Mark moved arguments as moved after a successful overload resolution.
 *
 * The `move` parameter form is gone — `move` only exists as a call-site
 * expression. Whenever a caller passes `move x`, the source identifier
 * is marked moved regardless of the parameter's modifiers.
 */
function applyMoveParams(checker: Checker, expr: CallExpr, _funcType: FunctionType): void {
  for (const arg of expr.args) {
    if (arg?.kind === "MoveExpr" && arg.operand.kind === "Identifier") {
      checker.markVariableMoved(arg.operand.name);
    }
  }
}

function checkFunctionCallArgs(
  checker: Checker,
  funcType: FunctionType,
  args: Expression[],
  expr: CallExpr,
  isMethod: boolean
): Type {
  // For instance methods, skip the self parameter
  const paramOffset = isMethod ? 1 : 0;
  const expectedParams = funcType.params.slice(paramOffset);
  const expectedCount = expectedParams.length;

  if (args.length !== expectedCount) {
    checker.error(`expected ${expectedCount} argument(s), got ${args.length}`, expr.span);
    return ERROR_TYPE;
  }

  for (let i = 0; i < args.length; i++) {
    const currentArg = args[i];
    if (!currentArg) continue;
    const argType = checker.checkExpression(currentArg);
    const param = expectedParams[i];
    if (!param) {
      throw new Error("invariant: function arity matched but parameter is missing");
    }
    const paramType = param.type;

    if (!isErrorType(argType) && !isAssignableTo(argType, paramType)) {
      // Check if this is a literal that can be implicitly converted
      const litInfo = extractLiteralInfo(currentArg);
      const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
      // Skip type param checks (generic functions)
      if (!isLiteralOk && paramType.kind !== TypeKind.TypeParam) {
        checker.error(
          `argument ${i + 1}: expected '${typeToString(paramType)}', got '${typeToString(argType)}'`,
          currentArg.span
        );
      }
    }

    // Handle `move x` at the call site — applies to any parameter regardless
    // of modifiers (the move-parameter form is gone; move is a call-site op).
    if (currentArg.kind === "MoveExpr" && currentArg.operand.kind === "Identifier") {
      checker.markVariableMoved(currentArg.operand.name);
    }
  }

  // Check throws — if function throws, the call must be wrapped in catch
  if (funcType.throwsTypes.length > 0) {
    // This is handled at the CatchExpr level — if there's no catch, it's an error
    // We flag it here: the caller must use catch
    checker.flagThrowsCall(expr, funcType);
  }

  return funcType.returnType;
}

/** Register a monomorphized function in the cache and record resolution metadata. */
function cacheMonomorphizedFunction(
  checker: Checker,
  expr: CallExpr,
  name: string,
  mangledName: string,
  resolvedTypeArgs: Type[],
  concreteType: FunctionType,
  declaration?: FunctionDecl
): void {
  if (!checker.getMonomorphizedFunction(mangledName)) {
    checker.registerMonomorphizedFunction(mangledName, {
      originalName: name,
      typeArgs: resolvedTypeArgs,
      concrete: concreteType,
      mangledName,
      declaration,
    });
  }
  checker.setExprType(expr.callee, concreteType);
  checker.setGenericResolution(expr, mangledName);
}

/** Handle generic function call with explicit type args: max<i32>(a, b) */
function checkGenericFunctionCall(checker: Checker, expr: CallExpr): Type {
  if (expr.callee.kind !== "Identifier") return ERROR_TYPE;
  const name = expr.callee.name;

  const sym = checker.currentScope.lookup(name);
  if (!sym || sym.kind !== SymbolKind.Function) {
    checker.error(`undeclared function '${name}'`, expr.span);
    return ERROR_TYPE;
  }

  // Find the generic overload
  const genericOverload = sym.overloads.find((o) => o.type.genericParams.length > 0);
  if (!genericOverload) {
    checker.error(
      `function '${name}' is not generic but was called with ${expr.typeArgs.length} type argument(s)`,
      expr.span
    );
    return ERROR_TYPE;
  }

  const funcType = genericOverload.type;
  if (expr.typeArgs.length !== funcType.genericParams.length) {
    checker.error(
      `function '${name}' expects ${funcType.genericParams.length} type argument(s) <${funcType.genericParams.join(", ")}>, got ${expr.typeArgs.length}`,
      expr.span
    );
    return ERROR_TYPE;
  }

  // Resolve type args
  const resolvedTypeArgs: Type[] = [];
  const typeMap = new Map<string, Type>();
  for (let i = 0; i < expr.typeArgs.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by typeArgs.length
    const typeArg = expr.typeArgs[i]!;
    const resolved = checker.resolveType(typeArg);
    if (isErrorType(resolved)) return ERROR_TYPE;
    resolvedTypeArgs.push(resolved);
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by typeArgs.length
    typeMap.set(funcType.genericParams[i]!, resolved);
  }

  // Create concrete function type
  const concreteType = substituteFunctionType(funcType, typeMap);
  const mangledName = mangleGenericName(name, resolvedTypeArgs);

  cacheMonomorphizedFunction(
    checker,
    expr,
    name,
    mangledName,
    resolvedTypeArgs,
    concreteType,
    genericOverload.declaration ?? undefined
  );

  return checkFunctionCallArgs(checker, concreteType, expr.args, expr, false);
}

/** Handle generic function call with inferred type args: max(10, 20) → infer T=i32 */
function checkGenericFunctionCallInferred(
  checker: Checker,
  funcType: FunctionType,
  expr: CallExpr
): Type {
  // First, type-check all arguments
  const argTypes: Type[] = [];
  for (const arg of expr.args) {
    argTypes.push(checker.checkExpression(arg));
  }
  if (argTypes.some((t) => isErrorType(t))) return ERROR_TYPE;

  // Check arity (skip self for methods)
  const paramOffset = 0;
  const expectedParams = funcType.params.slice(paramOffset);
  if (argTypes.length !== expectedParams.length) {
    checker.error(
      `expected ${expectedParams.length} argument(s), got ${argTypes.length}`,
      expr.span
    );
    return ERROR_TYPE;
  }

  // Infer type params from arguments
  const subs = new Map<string, Type>();
  for (let i = 0; i < expectedParams.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by expectedParams.length
    const paramType = expectedParams[i]!.type;
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by expectedParams.length
    const argType = argTypes[i]!;
    extractTypeParamSubs(paramType, argType, subs);
  }

  // Check that all type params were inferred
  for (const gp of funcType.genericParams) {
    if (!subs.has(gp)) {
      checker.error(
        `cannot infer type parameter '${gp}' — provide explicit type arguments`,
        expr.span
      );
      return ERROR_TYPE;
    }
  }

  // Create concrete function type
  const concreteType = substituteFunctionType(funcType, subs);
  // biome-ignore lint/style/noNonNullAssertion: all generic params guaranteed to be in subs map
  const resolvedTypeArgs = funcType.genericParams.map((gp) => subs.get(gp)!);
  const name = (expr.callee as { name: string }).name;
  const mangledName = mangleGenericName(name, resolvedTypeArgs);

  cacheMonomorphizedFunction(checker, expr, name, mangledName, resolvedTypeArgs, concreteType);

  // Validate args against concrete param types
  for (let i = 0; i < argTypes.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by argTypes.length
    const argType = argTypes[i]!;
    // biome-ignore lint/style/noNonNullAssertion: loop bounded by argTypes.length
    const paramType = concreteType.params[i]!.type;
    if (!isAssignableTo(argType, paramType)) {
      // biome-ignore lint/style/noNonNullAssertion: loop bounded by argTypes.length
      const litInfo = extractLiteralInfo(expr.args[i]!);
      const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
      if (!isLiteralOk) {
        checker.error(
          `argument ${i + 1}: expected '${typeToString(paramType)}', got '${typeToString(argType)}'`,
          // biome-ignore lint/style/noNonNullAssertion: loop bounded by argTypes.length
          expr.args[i]!.span
        );
      }
    }
  }

  // Handle throws
  if (concreteType.throwsTypes.length > 0) {
    checker.flagThrowsCall(expr, concreteType);
  }

  return concreteType.returnType;
}

/**
 * Register the monomorphization triggered by a `Type<TypeArgs>.method(args)`
 * static call. Mirrors the registration that happens for a struct literal
 * `Type<TypeArgs>{...}` in literal-checker so KIR lowering finds the
 * concrete struct in `monomorphizedStructs` and emits its methods.
 */
function registerStaticCallMonomorphization(
  checker: Checker,
  baseStruct: import("./types").StructType,
  resolvedTypeArgs: Type[],
  subs: Map<string, Type>,
  originalDecl?: import("../ast/nodes").StructDecl | import("../ast/nodes").UnsafeStructDecl
): void {
  const mangledName = mangleGenericName(baseStruct.name, resolvedTypeArgs);
  if (checker.getMonomorphizedStruct(mangledName)) return;

  const concreteFields = new Map<string, Type>();
  for (const [fieldName, fieldType] of baseStruct.fields) {
    concreteFields.set(fieldName, substituteTypeGeneric(fieldType, subs));
  }
  const concreteMethods = new Map<string, FunctionType>();
  for (const [methodName, methodType] of baseStruct.methods) {
    concreteMethods.set(methodName, substituteFunctionType(methodType, subs));
  }
  const concrete: import("./types").StructType = {
    kind: TypeKind.Struct,
    name: mangledName,
    fields: concreteFields,
    methods: concreteMethods,
    isUnsafe: baseStruct.isUnsafe,
    genericParams: [],
    modulePrefix: baseStruct.modulePrefix,
    genericBaseName: baseStruct.name,
    genericTypeArgs: resolvedTypeArgs,
    readonlyFields: baseStruct.readonlyFields,
  };
  checker.registerMonomorphizedStruct(mangledName, {
    original: baseStruct,
    typeArgs: resolvedTypeArgs,
    concrete,
    originalDecl,
  });
}
