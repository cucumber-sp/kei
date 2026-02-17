/**
 * Type-checks function call expressions: regular calls, overloaded calls,
 * generic function calls (explicit and inferred type args), module-qualified
 * calls, static method calls, and instance method calls.
 */

import type { CallExpr, Expression, FunctionDecl } from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { mangleGenericName, substituteFunctionType } from "./generics.ts";
import { extractTypeParamSubs } from "./literal-checker.ts";
import type { FunctionOverload } from "./symbols.ts";
import { SymbolKind } from "./symbols.ts";
import type { FunctionType, Type } from "./types";
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
    const sym = checker.currentScope.lookup(arg.name);
    if (!sym) {
      checker.error(`undeclared type '${arg.name}'`, arg.span);
      return ERROR_TYPE;
    }
  } else {
    checker.checkExpression(arg);
  }
  return USIZE_TYPE;
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

      // Check static method call: Type.method(args)
      const typeSym = checker.currentScope.lookupType(memberExpr.object.name);
      if (typeSym && typeSym.kind === SymbolKind.Type && typeSym.type.kind === TypeKind.Struct) {
        const structType = typeSym.type;
        const method = structType.methods.get(memberExpr.property);
        if (method) {
          // Static method — no self param check
          return checkFunctionCallArgs(checker, method, expr.args, expr, false);
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

/** Mark move parameters as moved after a successful overload resolution. */
function applyMoveParams(checker: Checker, expr: CallExpr, funcType: FunctionType): void {
  for (let i = 0; i < expr.args.length; i++) {
    const arg = expr.args[i];
    if (funcType.params[i]?.isMove && arg?.kind === "MoveExpr") {
      if (arg.operand.kind === "Identifier") {
        checker.markVariableMoved(arg.operand.name);
      }
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
    const paramType = expectedParams[i]?.type;

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

    // Handle move params
    if (expectedParams[i]?.isMove && currentArg.kind === "MoveExpr") {
      const moveExpr = currentArg;
      if (moveExpr.operand.kind === "Identifier") {
        checker.markVariableMoved(moveExpr.operand.name);
      }
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
  checker.genericResolutions.set(expr, mangledName);
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
