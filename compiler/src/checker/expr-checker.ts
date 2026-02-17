/**
 * Type-checks expressions and returns their resolved type.
 */

import type {
  CallExpr,
  CastExpr,
  CatchExpr,
  DerefExpr,
  Expression,
  GroupExpr,
  Identifier,
  IfExpr,
  IndexExpr,
  MemberExpr,
  MoveExpr,
  RangeExpr,
  ThrowExpr,
  UnsafeExpr,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { mangleGenericName, substituteFunctionType } from "./generics.ts";
import {
  checkArrayLiteral,
  checkBoolLiteral,
  checkFloatLiteral,
  checkIntLiteral,
  checkNullLiteral,
  checkStringLiteral,
  checkStructLiteral,
  extractTypeParamSubs,
} from "./literal-checker.ts";
import {
  checkAssignExpression,
  checkAssignTarget,
  checkBinaryExpression,
  checkDecrementExpression,
  checkIncrementExpression,
  checkUnaryExpression,
} from "./operator-checker.ts";
import type { FunctionOverload } from "./symbols.ts";
import { SymbolKind } from "./symbols.ts";
import type { FunctionType, Type } from "./types.ts";
import {
  ERROR_TYPE,
  extractLiteralInfo,
  isAssignableTo,
  isErrorType,
  isIntegerType,
  isLiteralAssignableTo,
  isNumericType,
  isPtrType,
  ptrType,
  rangeType,
  STRING_TYPE,
  TypeKind,
  typesEqual,
  typeToString,
  USIZE_TYPE,
  VOID_TYPE,
  BOOL_TYPE,
  isBoolType,
} from "./types.ts";

export class ExpressionChecker {
  private checker: Checker;

  constructor(checker: Checker) {
    this.checker = checker;
  }

  /** Type-check an expression and return its resolved type. */
  checkExpression(expr: Expression): Type {
    const type = this.checkExpressionInner(expr);
    this.checker.setExprType(expr, type);
    return type;
  }

  private checkExpressionInner(expr: Expression): Type {
    switch (expr.kind) {
      case "IntLiteral":
        return checkIntLiteral(expr);
      case "FloatLiteral":
        return checkFloatLiteral(expr);
      case "StringLiteral":
        return checkStringLiteral(expr);
      case "BoolLiteral":
        return checkBoolLiteral(expr);
      case "NullLiteral":
        return checkNullLiteral(expr);
      case "Identifier":
        return this.checkIdentifier(expr);
      case "BinaryExpr":
        return checkBinaryExpression(this.checker, expr);
      case "UnaryExpr":
        return checkUnaryExpression(this.checker, expr);
      case "CallExpr":
        return this.checkCallExpression(expr);
      case "MemberExpr":
        return this.checkMemberExpression(expr);
      case "IndexExpr":
        return this.checkIndexExpression(expr);
      case "DerefExpr":
        return this.checkDerefExpression(expr);
      case "AssignExpr":
        return checkAssignExpression(this.checker, expr);
      case "StructLiteral":
        return checkStructLiteral(this.checker, expr);
      case "IfExpr":
        return this.checkIfExpression(expr);
      case "MoveExpr":
        return this.checkMoveExpression(expr);
      case "CatchExpr":
        return this.checkCatchExpression(expr);
      case "ThrowExpr":
        return this.checkThrowExpression(expr);
      case "GroupExpr":
        return this.checkGroupExpression(expr);
      case "IncrementExpr":
        return checkIncrementExpression(this.checker, expr);
      case "DecrementExpr":
        return checkDecrementExpression(this.checker, expr);
      case "RangeExpr":
        return this.checkRangeExpression(expr);
      case "UnsafeExpr":
        return this.checkUnsafeExpression(expr);
      case "CastExpr":
        return this.checkCastExpression(expr);
      case "ArrayLiteral":
        return checkArrayLiteral(this.checker, expr);
    }
  }

  private checkIdentifier(expr: Identifier): Type {
    const sym = this.checker.currentScope.lookup(expr.name);
    if (!sym) {
      this.checker.error(`undeclared variable '${expr.name}'`, expr.span);
      return ERROR_TYPE;
    }

    if (sym.kind === SymbolKind.Variable) {
      if (sym.isMoved) {
        this.checker.error(`use of moved variable '${expr.name}'`, expr.span);
        return ERROR_TYPE;
      }
      return sym.type;
    }

    if (sym.kind === SymbolKind.Function) {
      return sym.type;
    }

    if (sym.kind === SymbolKind.Type) {
      // Type used as value — this is for static method access like Type.method()
      return sym.type;
    }

    if (sym.kind === SymbolKind.Module) {
      return sym.type;
    }

    return ERROR_TYPE;
  }

  private checkCallExpression(expr: CallExpr): Type {
    // Special case: sizeof(Type)
    if (expr.callee.kind === "Identifier" && expr.callee.name === "sizeof") {
      if (expr.args.length !== 1) {
        this.checker.error("'sizeof' expects exactly 1 argument", expr.span);
        return ERROR_TYPE;
      }
      // sizeof accepts a type name as argument — just check it resolves
      const arg = expr.args[0];
      if (!arg) return ERROR_TYPE;
      if (arg.kind === "Identifier") {
        const sym = this.checker.currentScope.lookup(arg.name);
        if (!sym) {
          this.checker.error(`undeclared type '${arg.name}'`, arg.span);
          return ERROR_TYPE;
        }
      } else {
        // Check the argument expression type
        this.checkExpression(arg);
      }
      return USIZE_TYPE;
    }

    // Special case: alloc<T>(count) and free(ptr) — require unsafe
    // Only applies when the function is in scope (imported from mem module)
    if (expr.callee.kind === "Identifier") {
      const name = expr.callee.name;
      if ((name === "alloc" || name === "free") && this.checker.currentScope.lookup(name)) {
        if (!this.checker.currentScope.isInsideUnsafe()) {
          this.checker.error(`cannot call '${name}' outside unsafe block`, expr.span);
          return ERROR_TYPE;
        }
        // For alloc, return ptr<T> (for now, use the argument context)
        if (name === "alloc") {
          if (expr.args.length !== 1) {
            this.checker.error("'alloc' expects exactly 1 argument", expr.span);
            return ERROR_TYPE;
          }
          const allocArg = expr.args[0];
          if (!allocArg) return ERROR_TYPE;
          const argType = this.checkExpression(allocArg);
          if (isErrorType(argType)) return ERROR_TYPE;
          // alloc returns ptr<T>, but we don't know T without type args on the call
          // The parser doesn't produce type args on call expressions
          // Return ptr<void> as a fallback — this handles the common case
          return ptrType(VOID_TYPE);
        }
        // free
        if (expr.args.length !== 1) {
          this.checker.error("'free' expects exactly 1 argument", expr.span);
          return ERROR_TYPE;
        }
        const freeArg = expr.args[0];
        if (!freeArg) return ERROR_TYPE;
        const argType = this.checkExpression(freeArg);
        if (!isErrorType(argType) && !isPtrType(argType)) {
          this.checker.error(
            `'free' expects a pointer argument, got '${typeToString(argType)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        return VOID_TYPE;
      }
    }

    // Check for generic function call with explicit type args: func<T>(args)
    if (expr.callee.kind === "Identifier" && expr.typeArgs.length > 0) {
      return this.checkGenericFunctionCall(expr);
    }

    // Check for generic function call with inferred type args
    if (expr.callee.kind === "Identifier") {
      const sym = this.checker.currentScope.lookup(expr.callee.name);
      if (sym && sym.kind === SymbolKind.Function) {
        // Check if any overload is generic
        const genericOverload = sym.overloads.find((o) => o.type.genericParams.length > 0);
        if (genericOverload && sym.overloads.length === 1) {
          return this.checkGenericFunctionCallInferred(genericOverload.type, expr);
        }
      }
    }

    // Check for overloaded function call by identifier
    if (expr.callee.kind === "Identifier") {
      const sym = this.checker.currentScope.lookup(expr.callee.name);
      if (sym && sym.kind === SymbolKind.Function && sym.overloads.length > 1) {
        return this.resolveOverloadedCall(sym.overloads, expr);
      }
    }

    // Check for module-qualified call or static method call: mod.func(args) or Type.method(args)
    if (expr.callee.kind === "MemberExpr") {
      const memberExpr = expr.callee;
      if (memberExpr.object.kind === "Identifier") {
        // Check module-qualified call: module.function(args)
        const modSym = this.checker.currentScope.lookup(memberExpr.object.name);
        if (modSym && modSym.kind === SymbolKind.Module) {
          // Store the module type in typeMap so the lowerer can detect module-qualified calls
          this.checker.setExprType(memberExpr.object, modSym.type);
          const exportedSym = modSym.symbols.get(memberExpr.property);
          if (exportedSym && exportedSym.kind === SymbolKind.Function) {
            // Handle overloaded module functions
            if (exportedSym.overloads.length > 1) {
              return this.resolveOverloadedCall(exportedSym.overloads, expr);
            }
            this.checker.setExprType(expr.callee, exportedSym.type);
            return this.checkFunctionCallArgs(exportedSym.type, expr.args, expr, false);
          }
          if (exportedSym && exportedSym.kind === SymbolKind.Type && exportedSym.type.kind === TypeKind.Struct) {
            // Module-qualified static method: module.Struct.method() — handled below via normal MemberExpr flow
          }
          if (!exportedSym) {
            this.checker.error(
              `module '${modSym.name}' has no exported member '${memberExpr.property}'`,
              expr.span
            );
            return ERROR_TYPE;
          }
        }

        // Check static method call: Type.method(args)
        const typeSym = this.checker.currentScope.lookupType(memberExpr.object.name);
        if (typeSym && typeSym.kind === SymbolKind.Type && typeSym.type.kind === TypeKind.Struct) {
          const structType = typeSym.type;
          const method = structType.methods.get(memberExpr.property);
          if (method) {
            // Static method — no self param check
            return this.checkFunctionCallArgs(method, expr.args, expr, false);
          }
          this.checker.error(
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
    const calleeType = this.checkExpression(expr.callee);
    if (isErrorType(calleeType)) return ERROR_TYPE;

    if (calleeType.kind === TypeKind.Function) {
      // Check extern fn requires unsafe
      if (calleeType.isExtern && !this.checker.currentScope.isInsideUnsafe()) {
        this.checker.error("cannot call extern function outside unsafe block", expr.span);
        return ERROR_TYPE;
      }

      // For instance method calls, skip the self parameter
      if (isInstanceMethodCall && calleeType.params.length > 0) {
        const firstParam = calleeType.params[0];
        if (firstParam && firstParam.name === "self") {
          return this.checkFunctionCallArgs(calleeType, expr.args, expr, true);
        }
      }

      return this.checkFunctionCallArgs(calleeType, expr.args, expr, false);
    }

    this.checker.error(
      `expression of type '${typeToString(calleeType)}' is not callable`,
      expr.span
    );
    return ERROR_TYPE;
  }

  /** Resolve an overloaded function call by matching argument types exactly. */
  private resolveOverloadedCall(
    overloads: FunctionOverload[],
    expr: CallExpr
  ): Type {
    // First, type-check all arguments
    const argTypes: Type[] = [];
    for (const arg of expr.args) {
      argTypes.push(this.checkExpression(arg));
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
      const matched = matches[0]!;
      // Store the resolved overload type on the callee expression
      this.checker.setExprType(expr.callee, matched.type);

      // Handle move params
      for (let i = 0; i < expr.args.length; i++) {
        const arg = expr.args[i];
        if (matched.type.params[i]?.isMove && arg?.kind === "MoveExpr") {
          const moveExpr = arg;
          if (moveExpr.operand.kind === "Identifier") {
            this.checker.markVariableMoved(moveExpr.operand.name);
          }
        }
      }

      // Check throws
      if (matched.type.throwsTypes.length > 0) {
        this.checker.flagThrowsCall(expr, matched.type);
      }

      return matched.type.returnType;
    }

    if (matches.length > 1) {
      this.checker.error("ambiguous call — multiple overloads match", expr.span);
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
          const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
          if (!isLiteralOk) {
            allAssignable = false;
            break;
          }
        }
      }
      if (allAssignable) wideMatches.push(overload);
    }

    if (wideMatches.length === 1) {
      const matched = wideMatches[0]!;
      this.checker.setExprType(expr.callee, matched.type);

      for (let i = 0; i < expr.args.length; i++) {
        const arg = expr.args[i];
        if (matched.type.params[i]?.isMove && arg?.kind === "MoveExpr") {
          const moveExpr = arg;
          if (moveExpr.operand.kind === "Identifier") {
            this.checker.markVariableMoved(moveExpr.operand.name);
          }
        }
      }

      if (matched.type.throwsTypes.length > 0) {
        this.checker.flagThrowsCall(expr, matched.type);
      }

      return matched.type.returnType;
    }

    if (wideMatches.length > 1) {
      this.checker.error("ambiguous call — multiple overloads match", expr.span);
      return ERROR_TYPE;
    }

    // No match at all
    const argStr = argTypes.map((t) => typeToString(t)).join(", ");
    this.checker.error(`no matching overload for call with arguments (${argStr})`, expr.span);
    return ERROR_TYPE;
  }

  private checkFunctionCallArgs(
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
      this.checker.error(`expected ${expectedCount} argument(s), got ${args.length}`, expr.span);
      return ERROR_TYPE;
    }

    for (let i = 0; i < args.length; i++) {
      const currentArg = args[i];
      if (!currentArg) continue;
      const argType = this.checkExpression(currentArg);
      const paramType = expectedParams[i]?.type;

      if (!isErrorType(argType) && !isAssignableTo(argType, paramType)) {
        // Check if this is a literal that can be implicitly converted
        const litInfo = extractLiteralInfo(currentArg);
        const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
        // Skip type param checks (generic functions)
        if (!isLiteralOk && paramType.kind !== TypeKind.TypeParam) {
          this.checker.error(
            `argument ${i + 1}: expected '${typeToString(paramType)}', got '${typeToString(argType)}'`,
            currentArg.span
          );
        }
      }

      // Handle move params
      if (expectedParams[i]?.isMove && currentArg.kind === "MoveExpr") {
        const moveExpr = currentArg;
        if (moveExpr.operand.kind === "Identifier") {
          this.checker.markVariableMoved(moveExpr.operand.name);
        }
      }
    }

    // Check throws — if function throws, the call must be wrapped in catch
    if (funcType.throwsTypes.length > 0) {
      // This is handled at the CatchExpr level — if there's no catch, it's an error
      // We flag it here: the caller must use catch
      this.checker.flagThrowsCall(expr, funcType);
    }

    return funcType.returnType;
  }

  /** Handle generic function call with explicit type args: max<i32>(a, b) */
  private checkGenericFunctionCall(expr: CallExpr): Type {
    if (expr.callee.kind !== "Identifier") return ERROR_TYPE;
    const name = expr.callee.name;

    const sym = this.checker.currentScope.lookup(name);
    if (!sym || sym.kind !== SymbolKind.Function) {
      this.checker.error(`undeclared function '${name}'`, expr.span);
      return ERROR_TYPE;
    }

    // Find the generic overload
    const genericOverload = sym.overloads.find((o) => o.type.genericParams.length > 0);
    if (!genericOverload) {
      this.checker.error(`function '${name}' is not generic`, expr.span);
      return ERROR_TYPE;
    }

    const funcType = genericOverload.type;
    if (expr.typeArgs.length !== funcType.genericParams.length) {
      this.checker.error(
        `function '${name}' expects ${funcType.genericParams.length} type argument(s), got ${expr.typeArgs.length}`,
        expr.span
      );
      return ERROR_TYPE;
    }

    // Resolve type args
    const resolvedTypeArgs: Type[] = [];
    const typeMap = new Map<string, Type>();
    for (let i = 0; i < expr.typeArgs.length; i++) {
      const typeArg = expr.typeArgs[i]!;
      const resolved = this.checker.resolveType(typeArg);
      if (isErrorType(resolved)) return ERROR_TYPE;
      resolvedTypeArgs.push(resolved);
      typeMap.set(funcType.genericParams[i]!, resolved);
    }

    // Create concrete function type
    const concreteType = substituteFunctionType(funcType, typeMap);
    const mangledName = mangleGenericName(name, resolvedTypeArgs);

    // Cache the monomorphized function
    if (!this.checker.getMonomorphizedFunction(mangledName)) {
      this.checker.registerMonomorphizedFunction(mangledName, {
        originalName: name,
        typeArgs: resolvedTypeArgs,
        concrete: concreteType,
        mangledName,
        declaration: genericOverload.declaration ?? undefined,
      });
    }

    // Store the concrete type on the callee and the mangled name resolution
    this.checker.setExprType(expr.callee, concreteType);
    this.checker.genericResolutions.set(expr, mangledName);

    return this.checkFunctionCallArgs(concreteType, expr.args, expr, false);
  }

  /** Handle generic function call with inferred type args: max(10, 20) → infer T=i32 */
  private checkGenericFunctionCallInferred(funcType: FunctionType, expr: CallExpr): Type {
    // First, type-check all arguments
    const argTypes: Type[] = [];
    for (const arg of expr.args) {
      argTypes.push(this.checkExpression(arg));
    }
    if (argTypes.some((t) => isErrorType(t))) return ERROR_TYPE;

    // Check arity (skip self for methods)
    const paramOffset = 0;
    const expectedParams = funcType.params.slice(paramOffset);
    if (argTypes.length !== expectedParams.length) {
      this.checker.error(
        `expected ${expectedParams.length} argument(s), got ${argTypes.length}`,
        expr.span
      );
      return ERROR_TYPE;
    }

    // Infer type params from arguments
    const subs = new Map<string, Type>();
    for (let i = 0; i < expectedParams.length; i++) {
      const paramType = expectedParams[i]!.type;
      const argType = argTypes[i]!;
      extractTypeParamSubs(paramType, argType, subs);
    }

    // Check that all type params were inferred
    for (const gp of funcType.genericParams) {
      if (!subs.has(gp)) {
        this.checker.error(
          `cannot infer type parameter '${gp}' — provide explicit type arguments`,
          expr.span
        );
        return ERROR_TYPE;
      }
    }

    // Create concrete function type
    const concreteType = substituteFunctionType(funcType, subs);
    const resolvedTypeArgs = funcType.genericParams.map((gp) => subs.get(gp)!);
    const name = (expr.callee as { name: string }).name;
    const mangledName = mangleGenericName(name, resolvedTypeArgs);

    // Cache
    if (!this.checker.getMonomorphizedFunction(mangledName)) {
      this.checker.registerMonomorphizedFunction(mangledName, {
        originalName: name,
        typeArgs: resolvedTypeArgs,
        concrete: concreteType,
        mangledName,
      });
    }

    // Store the concrete type on the callee and the mangled name resolution
    this.checker.setExprType(expr.callee, concreteType);
    this.checker.genericResolutions.set(expr, mangledName);

    // Validate args against concrete param types
    for (let i = 0; i < argTypes.length; i++) {
      const argType = argTypes[i]!;
      const paramType = concreteType.params[i]!.type;
      if (!isAssignableTo(argType, paramType)) {
        const litInfo = extractLiteralInfo(expr.args[i]!);
        const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, paramType);
        if (!isLiteralOk) {
          this.checker.error(
            `argument ${i + 1}: expected '${typeToString(paramType)}', got '${typeToString(argType)}'`,
            expr.args[i]!.span
          );
        }
      }
    }

    // Handle throws
    if (concreteType.throwsTypes.length > 0) {
      this.checker.flagThrowsCall(expr, concreteType);
    }

    return concreteType.returnType;
  }

  private checkMemberExpression(expr: MemberExpr): Type {
    const objectType = this.checkExpression(expr.object);
    if (isErrorType(objectType)) return ERROR_TYPE;

    // Module-qualified access: math.add, net.http.Server
    if (objectType.kind === TypeKind.Module) {
      const exportedType = objectType.exports.get(expr.property);
      if (exportedType) return exportedType;

      this.checker.error(
        `module '${objectType.name}' has no exported member '${expr.property}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.Struct) {
      // Check fields first
      const fieldType = objectType.fields.get(expr.property);
      if (fieldType) return fieldType;

      // Check methods
      const methodType = objectType.methods.get(expr.property);
      if (methodType) return methodType;

      // Check if it's a type being used for static method access
      this.checker.error(
        `type '${objectType.name}' has no field or method '${expr.property}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.Enum) {
      // Enum variant access
      const variant = objectType.variants.find((v) => v.name === expr.property);
      if (variant) {
        // For simple enums, the variant value is the enum type itself
        return objectType;
      }
      this.checker.error(`enum '${objectType.name}' has no variant '${expr.property}'`, expr.span);
      return ERROR_TYPE;
    }

    // Check for .len on array/slice/string
    if (expr.property === "len") {
      if (
        objectType.kind === TypeKind.Array ||
        objectType.kind === TypeKind.Slice ||
        objectType.kind === TypeKind.String
      ) {
        return USIZE_TYPE;
      }
    }

    this.checker.error(
      `type '${typeToString(objectType)}' has no property '${expr.property}'`,
      expr.span
    );
    return ERROR_TYPE;
  }

  private checkIndexExpression(expr: IndexExpr): Type {
    const objectType = this.checkExpression(expr.object);
    const indexType = this.checkExpression(expr.index);

    if (isErrorType(objectType) || isErrorType(indexType)) return ERROR_TYPE;

    // Operator overloading: struct with op_index
    if (objectType.kind === TypeKind.Struct) {
      const method = objectType.methods.get("op_index");
      if (method) {
        // op_index takes self + index param
        if (method.params.length !== 2) {
          this.checker.error(
            `'op_index' method must take exactly 2 parameters (self, index), got ${method.params.length}`,
            expr.span
          );
          return ERROR_TYPE;
        }
        const indexParam = method.params[1]!;
        if (!isAssignableTo(indexType, indexParam.type)) {
          this.checker.error(
            `index type mismatch: expected '${typeToString(indexParam.type)}', got '${typeToString(indexType)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        this.checker.operatorMethods.set(expr, { methodName: "op_index", structType: objectType });
        return method.returnType;
      }
    }

    if (
      objectType.kind !== TypeKind.Array &&
      objectType.kind !== TypeKind.Slice &&
      objectType.kind !== TypeKind.String
    ) {
      this.checker.error(`cannot index type '${typeToString(objectType)}'`, expr.span);
      return ERROR_TYPE;
    }

    if (!isIntegerType(indexType)) {
      this.checker.error(
        `index must be an integer type, got '${typeToString(indexType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.String) return STRING_TYPE;
    return objectType.element;
  }

  private checkDerefExpression(expr: DerefExpr): Type {
    if (!this.checker.currentScope.isInsideUnsafe()) {
      this.checker.error("pointer dereference requires unsafe block", expr.span);
      return ERROR_TYPE;
    }

    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    if (!isPtrType(operandType)) {
      this.checker.error(
        `cannot dereference non-pointer type '${typeToString(operandType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return operandType.pointee;
  }

  private checkIfExpression(expr: IfExpr): Type {
    const condType = this.checkExpression(expr.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `if expression condition must be bool, got '${typeToString(condType)}'`,
        expr.condition.span
      );
    }

    // Check both branches
    const thenType = this.checker.checkBlockExpressionType(expr.thenBlock);
    const elseType = this.checker.checkBlockExpressionType(expr.elseBlock);

    if (isErrorType(thenType) || isErrorType(elseType)) return ERROR_TYPE;

    if (!typesEqual(thenType, elseType)) {
      this.checker.error(
        `if expression branches have different types: '${typeToString(thenType)}' and '${typeToString(elseType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return thenType;
  }

  private checkMoveExpression(expr: MoveExpr): Type {
    // Move operand must be a variable identifier
    if (expr.operand.kind !== "Identifier") {
      this.checker.error("'move' can only be applied to a variable", expr.span);
      return ERROR_TYPE;
    }

    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    // Mark variable as moved
    this.checker.markVariableMoved(expr.operand.name);

    return operandType;
  }

  private checkCatchExpression(expr: CatchExpr): Type {
    // The operand should be a function call that throws
    const operandType = this.checkExpression(expr.operand);

    // Clear the throws flag since we're handling it with catch
    if (expr.operand.kind === "CallExpr") {
      this.checker.clearThrowsCall(expr.operand);
    }

    if (isErrorType(operandType)) return ERROR_TYPE;

    // Get the throws types from the function call
    const throwsInfo = this.checker.getThrowsInfo(expr.operand);

    if (expr.catchType === "panic") {
      // catch panic — always valid
      return operandType;
    }

    if (expr.catchType === "throw") {
      // catch throw — propagate errors to enclosing function
      const enclosingFn = this.checker.currentScope.getEnclosingFunction();
      if (!enclosingFn) {
        this.checker.error("cannot use 'catch throw' outside a function", expr.span);
        return ERROR_TYPE;
      }
      if (enclosingFn.throwsTypes.length === 0) {
        this.checker.error(
          "cannot use 'catch throw' — function does not declare 'throws'",
          expr.span
        );
        return ERROR_TYPE;
      }
      // Check that all thrown types are in the enclosing function's throws
      if (throwsInfo) {
        for (const thrownType of throwsInfo) {
          const canPropagate = enclosingFn.throwsTypes.some((t) => typesEqual(t, thrownType));
          if (!canPropagate) {
            this.checker.error(
              `cannot propagate error type '${typeToString(thrownType)}' — not in function's throws clause`,
              expr.span
            );
          }
        }
      }
      return operandType;
    }

    // catch { clauses } — block catch
    if (throwsInfo && throwsInfo.length > 0) {
      const handledTypes = new Set<string>();
      let hasDefault = false;

      for (const clause of expr.clauses) {
        if (clause.isDefault) {
          hasDefault = true;
          // Check clause body
          this.checker.pushScope({});
          if (clause.varName) {
            // Default clause var — type is the union of unhandled error types (use first for now)
            const unhandledTypes = throwsInfo.filter((t) => !handledTypes.has(typeToString(t)));
            const firstUnhandled = unhandledTypes[0];
            if (firstUnhandled) {
              this.checker.defineVariable(
                clause.varName,
                firstUnhandled,
                false,
                false,
                clause.span
              );
            }
          }
          for (const stmt of clause.body) {
            this.checker.checkStatement(stmt);
          }
          this.checker.popScope();
          continue;
        }

        // Named error type clause
        const errorTypeName = clause.errorType;
        const errorType = throwsInfo.find(
          (t) =>
            (t.kind === TypeKind.Struct && t.name === errorTypeName) ||
            typeToString(t) === errorTypeName
        );

        if (!errorType) {
          this.checker.error(
            `error type '${errorTypeName}' is not thrown by the callee`,
            clause.span
          );
          continue;
        }

        handledTypes.add(typeToString(errorType));

        // Check clause body with error variable in scope
        this.checker.pushScope({});
        if (clause.varName) {
          this.checker.defineVariable(clause.varName, errorType, false, false, clause.span);
        }
        for (const stmt of clause.body) {
          this.checker.checkStatement(stmt);
        }
        this.checker.popScope();
      }

      // Check exhaustiveness
      if (!hasDefault) {
        const unhandled = throwsInfo.filter((t) => !handledTypes.has(typeToString(t)));
        if (unhandled.length > 0) {
          const names = unhandled.map((t) => typeToString(t)).join(", ");
          this.checker.error(`unhandled error types: ${names}`, expr.span);
        }
      }
    }

    return operandType;
  }

  private checkThrowExpression(expr: ThrowExpr): Type {
    const valueType = this.checkExpression(expr.value);
    if (isErrorType(valueType)) return ERROR_TYPE;

    const enclosingFn = this.checker.currentScope.getEnclosingFunction();
    if (!enclosingFn) {
      this.checker.error("'throw' used outside of a function", expr.span);
      return ERROR_TYPE;
    }

    if (enclosingFn.throwsTypes.length === 0) {
      this.checker.error("'throw' used in function that does not declare 'throws'", expr.span);
      return ERROR_TYPE;
    }

    // Check that the thrown type is one of the declared throws types
    const isValidThrowType = enclosingFn.throwsTypes.some((t) => typesEqual(t, valueType));
    if (!isValidThrowType) {
      this.checker.error(
        `error type '${typeToString(valueType)}' is not declared in function's throws clause`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return VOID_TYPE;
  }

  private checkGroupExpression(expr: GroupExpr): Type {
    return this.checkExpression(expr.expression);
  }

  private checkRangeExpression(expr: RangeExpr): Type {
    const startType = this.checkExpression(expr.start);
    const endType = this.checkExpression(expr.end);

    if (isErrorType(startType) || isErrorType(endType)) return ERROR_TYPE;

    if (!isIntegerType(startType)) {
      this.checker.error(
        `range start must be integer type, got '${typeToString(startType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (!typesEqual(startType, endType)) {
      this.checker.error(
        `range start and end must be same type, got '${typeToString(startType)}' and '${typeToString(endType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return rangeType(startType);
  }

  private checkUnsafeExpression(expr: UnsafeExpr): Type {
    this.checker.pushScope({ isUnsafe: true });
    let lastType: Type = VOID_TYPE;

    for (const stmt of expr.body.statements) {
      if (stmt.kind === "ExprStmt") {
        lastType = this.checker.checkExpression(stmt.expression);
      } else {
        this.checker.checkStatement(stmt);
        lastType = VOID_TYPE;
      }
    }

    this.checker.popScope();
    return lastType;
  }

  private checkCastExpression(expr: CastExpr): Type {
    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    const targetType = this.checker.resolveType(expr.targetType);
    if (isErrorType(targetType)) return ERROR_TYPE;

    // Same type → no-op, always allowed
    if (typesEqual(operandType, targetType)) return targetType;

    // numeric → numeric (int↔float, int↔int, float↔float)
    if (isNumericType(operandType) && isNumericType(targetType)) return targetType;

    // bool → int
    if (isBoolType(operandType) && isIntegerType(targetType)) return targetType;

    // ptr → ptr (unsafe only)
    if (isPtrType(operandType) && isPtrType(targetType)) {
      if (!this.checker.currentScope.isInsideUnsafe()) {
        this.checker.error("pointer cast requires unsafe block", expr.span);
        return ERROR_TYPE;
      }
      return targetType;
    }

    this.checker.error(
      `cannot cast '${typeToString(operandType)}' to '${typeToString(targetType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }
}
