/**
 * Type-checks expressions and returns their resolved type.
 */

import type {
  AssignExpr,
  BinaryExpr,
  BoolLiteral,
  CallExpr,
  CatchExpr,
  DecrementExpr,
  DerefExpr,
  Expression,
  FloatLiteral,
  GroupExpr,
  Identifier,
  IfExpr,
  IncrementExpr,
  IndexExpr,
  IntLiteral,
  MemberExpr,
  MoveExpr,
  NullLiteral,
  RangeExpr,
  StringLiteral,
  StructLiteral,
  ThrowExpr,
  UnaryExpr,
  UnsafeExpr,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import type { FunctionOverload } from "./symbols.ts";
import { SymbolKind } from "./symbols.ts";
import type { ArrayType, FunctionType, PtrType, RangeType, SliceType, StructType, Type } from "./types.ts";
import {
  BOOL_TYPE,
  ERROR_TYPE,
  F64_TYPE,
  I32_TYPE,
  I64_TYPE,
  isAssignableTo,
  isErrorType,
  isIntegerType,
  isNumericType,
  isPtrType,
  NULL_TYPE,
  ptrType,
  rangeType,
  STRING_TYPE,
  TypeKind,
  typesEqual,
  typeToString,
  USIZE_TYPE,
  VOID_TYPE,
} from "./types.ts";

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);
const COMPARISON_OPS = new Set(["<", ">", "<=", ">="]);
const EQUALITY_OPS = new Set(["==", "!="]);
const LOGICAL_OPS = new Set(["&&", "||"]);
const BITWISE_OPS = new Set(["&", "|", "^", "<<", ">>"]);
const COMPOUND_ASSIGN_OPS = new Set(["+=", "-=", "*=", "/=", "%="]);
const COMPOUND_BITWISE_OPS = new Set(["&=", "|=", "^=", "<<=", ">>="]);

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
        return this.checkIntLiteral(expr);
      case "FloatLiteral":
        return this.checkFloatLiteral(expr);
      case "StringLiteral":
        return this.checkStringLiteral(expr);
      case "BoolLiteral":
        return this.checkBoolLiteral(expr);
      case "NullLiteral":
        return this.checkNullLiteral(expr);
      case "Identifier":
        return this.checkIdentifier(expr);
      case "BinaryExpr":
        return this.checkBinaryExpression(expr);
      case "UnaryExpr":
        return this.checkUnaryExpression(expr);
      case "CallExpr":
        return this.checkCallExpression(expr);
      case "MemberExpr":
        return this.checkMemberExpression(expr);
      case "IndexExpr":
        return this.checkIndexExpression(expr);
      case "DerefExpr":
        return this.checkDerefExpression(expr);
      case "AssignExpr":
        return this.checkAssignExpression(expr);
      case "StructLiteral":
        return this.checkStructLiteral(expr);
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
        return this.checkIncrementExpression(expr);
      case "DecrementExpr":
        return this.checkDecrementExpression(expr);
      case "RangeExpr":
        return this.checkRangeExpression(expr);
      case "UnsafeExpr":
        return this.checkUnsafeExpression(expr);
    }
  }

  private checkIntLiteral(expr: IntLiteral): Type {
    const v = expr.value;
    if (v >= -2147483648 && v <= 2147483647) {
      return I32_TYPE;
    }
    return I64_TYPE;
  }

  private checkFloatLiteral(_expr: FloatLiteral): Type {
    return F64_TYPE;
  }

  private checkStringLiteral(_expr: StringLiteral): Type {
    return STRING_TYPE;
  }

  private checkBoolLiteral(_expr: BoolLiteral): Type {
    return BOOL_TYPE;
  }

  private checkNullLiteral(_expr: NullLiteral): Type {
    return NULL_TYPE;
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

    return ERROR_TYPE;
  }

  private checkBinaryExpression(expr: BinaryExpr): Type {
    const left = this.checkExpression(expr.left);
    const right = this.checkExpression(expr.right);

    if (isErrorType(left) || isErrorType(right)) return ERROR_TYPE;

    const op = expr.operator;

    // String concatenation
    if (op === "+" && left.kind === TypeKind.String && right.kind === TypeKind.String) {
      return STRING_TYPE;
    }

    // Arithmetic operators
    if (ARITHMETIC_OPS.has(op)) {
      if (!isNumericType(left)) {
        this.checker.error(
          `operator '${op}' requires numeric operands, got '${typeToString(left)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!typesEqual(left, right)) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return left;
    }

    // Comparison operators
    if (COMPARISON_OPS.has(op)) {
      if (!isNumericType(left)) {
        this.checker.error(
          `operator '${op}' requires numeric operands, got '${typeToString(left)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!typesEqual(left, right)) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return BOOL_TYPE;
    }

    // Equality operators
    if (EQUALITY_OPS.has(op)) {
      // Allow equality between same types, or ptr and null
      if (
        !typesEqual(left, right) &&
        !(isPtrType(left) && right.kind === TypeKind.Null) &&
        !(left.kind === TypeKind.Null && isPtrType(right))
      ) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return BOOL_TYPE;
    }

    // Logical operators
    if (LOGICAL_OPS.has(op)) {
      if (left.kind !== TypeKind.Bool) {
        this.checker.error(
          `operator '${op}' requires bool operands, got '${typeToString(left)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (right.kind !== TypeKind.Bool) {
        this.checker.error(
          `operator '${op}' requires bool operands, got '${typeToString(right)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return BOOL_TYPE;
    }

    // Bitwise operators
    if (BITWISE_OPS.has(op)) {
      if (!isIntegerType(left)) {
        this.checker.error(
          `operator '${op}' requires integer operands, got '${typeToString(left)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!typesEqual(left, right)) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return left;
    }

    this.checker.error(`unknown binary operator '${op}'`, expr.span);
    return ERROR_TYPE;
  }

  private checkUnaryExpression(expr: UnaryExpr): Type {
    const operand = this.checkExpression(expr.operand);
    if (isErrorType(operand)) return ERROR_TYPE;

    switch (expr.operator) {
      case "-":
        if (!isNumericType(operand)) {
          this.checker.error(
            `unary '-' requires numeric operand, got '${typeToString(operand)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        return operand;

      case "!":
        if (operand.kind !== TypeKind.Bool) {
          this.checker.error(
            `unary '!' requires bool operand, got '${typeToString(operand)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        return BOOL_TYPE;

      case "~":
        if (!isIntegerType(operand)) {
          this.checker.error(
            `unary '~' requires integer operand, got '${typeToString(operand)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        return operand;

      case "&":
        if (!this.checker.currentScope.isInsideUnsafe()) {
          this.checker.error("address-of operator '&' requires unsafe block", expr.span);
          return ERROR_TYPE;
        }
        return ptrType(operand);

      default:
        this.checker.error(`unknown unary operator '${expr.operator}'`, expr.span);
        return ERROR_TYPE;
    }
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
    if (expr.callee.kind === "Identifier") {
      const name = expr.callee.name;
      if (name === "alloc" || name === "free") {
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

    // Check for overloaded function call by identifier
    if (expr.callee.kind === "Identifier") {
      const sym = this.checker.currentScope.lookup(expr.callee.name);
      if (sym && sym.kind === SymbolKind.Function && sym.overloads.length > 1) {
        return this.resolveOverloadedCall(sym.overloads, expr);
      }
    }

    // Check for static method call: Type.method(args)
    if (expr.callee.kind === "MemberExpr") {
      const memberExpr = expr.callee;
      if (memberExpr.object.kind === "Identifier") {
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
          const moveExpr = arg as MoveExpr;
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

    // No exact match — try with assignability (widening)
    const wideMatches: FunctionOverload[] = [];
    for (const overload of overloads) {
      const params = overload.type.params;
      if (params.length !== argTypes.length) continue;

      let allAssignable = true;
      for (let i = 0; i < params.length; i++) {
        const paramType = params[i]?.type;
        const argType = argTypes[i];
        if (!paramType || !argType || !isAssignableTo(argType, paramType)) {
          allAssignable = false;
          break;
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
          const moveExpr = arg as MoveExpr;
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
        // Skip type param checks (generic functions)
        if (paramType.kind !== TypeKind.TypeParam) {
          this.checker.error(
            `argument ${i + 1}: expected '${typeToString(paramType)}', got '${typeToString(argType)}'`,
            currentArg.span
          );
        }
      }

      // Handle move params
      if (expectedParams[i]?.isMove && currentArg.kind === "MoveExpr") {
        const moveExpr = currentArg as MoveExpr;
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

  private checkMemberExpression(expr: MemberExpr): Type {
    const objectType = this.checkExpression(expr.object);
    if (isErrorType(objectType)) return ERROR_TYPE;

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

  private checkAssignExpression(expr: AssignExpr): Type {
    const targetType = this.checkExpression(expr.target);
    const valueType = this.checkExpression(expr.value);

    if (isErrorType(targetType) || isErrorType(valueType)) return ERROR_TYPE;

    // Check mutability
    this.checkAssignTarget(expr.target);

    const op = expr.operator;

    if (op === "=") {
      if (!isAssignableTo(valueType, targetType)) {
        this.checker.error(
          `type mismatch: expected '${typeToString(targetType)}', got '${typeToString(valueType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return targetType;
    }

    // Compound assignment
    if (COMPOUND_ASSIGN_OPS.has(op)) {
      if (!isNumericType(targetType)) {
        this.checker.error(
          `operator '${op}' requires numeric type, got '${typeToString(targetType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!typesEqual(targetType, valueType)) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(targetType)}' and '${typeToString(valueType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return targetType;
    }

    if (COMPOUND_BITWISE_OPS.has(op)) {
      if (!isIntegerType(targetType)) {
        this.checker.error(
          `operator '${op}' requires integer type, got '${typeToString(targetType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!typesEqual(targetType, valueType)) {
        this.checker.error(
          `operator '${op}' requires same types, got '${typeToString(targetType)}' and '${typeToString(valueType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return targetType;
    }

    this.checker.error(`unknown assignment operator '${op}'`, expr.span);
    return ERROR_TYPE;
  }

  private checkAssignTarget(target: Expression): void {
    if (target.kind === "Identifier") {
      const sym = this.checker.currentScope.lookup(target.name);
      if (sym && sym.kind === SymbolKind.Variable) {
        if (!sym.isMutable) {
          this.checker.error(`cannot assign to immutable variable '${target.name}'`, target.span);
        }
      }
    }
    // MemberExpr and IndexExpr and DerefExpr — check the root object is mutable
    if (target.kind === "MemberExpr") {
      this.checkAssignTarget(target.object);
    }
    if (target.kind === "DerefExpr") {
      // Deref assignment is allowed in unsafe
      if (!this.checker.currentScope.isInsideUnsafe()) {
        this.checker.error("pointer dereference assignment requires unsafe block", target.span);
      }
    }
  }

  private checkStructLiteral(expr: StructLiteral): Type {
    // Look up the struct type
    const sym = this.checker.currentScope.lookupType(expr.name);
    if (!sym || sym.kind !== SymbolKind.Type) {
      this.checker.error(`undeclared type '${expr.name}'`, expr.span);
      return ERROR_TYPE;
    }

    let structType = sym.type;

    // Handle generic struct instantiation with explicit type args
    if (
      structType.kind === TypeKind.Struct &&
      structType.genericParams.length > 0 &&
      expr.typeArgs.length > 0
    ) {
      structType = this.checker.resolveType({
        kind: "GenericType",
        name: expr.name,
        typeArgs: expr.typeArgs,
        span: expr.span,
      });
    }

    if (structType.kind !== TypeKind.Struct) {
      this.checker.error(`'${expr.name}' is not a struct type`, expr.span);
      return ERROR_TYPE;
    }

    // Infer generic type params from field values when no explicit type args
    if (structType.genericParams.length > 0 && expr.typeArgs.length === 0) {
      return this.checkGenericStructLiteralInferred(structType, expr);
    }

    // Check all fields are provided
    const providedFields = new Set<string>();
    for (const field of expr.fields) {
      if (providedFields.has(field.name)) {
        this.checker.error(`duplicate field '${field.name}' in struct literal`, field.span);
        continue;
      }
      providedFields.add(field.name);

      const expectedType = structType.fields.get(field.name);
      if (!expectedType) {
        this.checker.error(`struct '${structType.name}' has no field '${field.name}'`, field.span);
        continue;
      }

      const valueType = this.checkExpression(field.value);
      if (!isErrorType(valueType) && !isAssignableTo(valueType, expectedType)) {
        this.checker.error(
          `field '${field.name}': expected '${typeToString(expectedType)}', got '${typeToString(valueType)}'`,
          field.span
        );
      }
    }

    // Check all required fields are present
    for (const [fieldName] of structType.fields) {
      if (!providedFields.has(fieldName)) {
        this.checker.error(
          `missing field '${fieldName}' in struct literal '${structType.name}'`,
          expr.span
        );
      }
    }

    return structType;
  }

  /** Handle generic struct literal where type params are inferred from field values. */
  private checkGenericStructLiteralInferred(
    structType: StructType,
    expr: StructLiteral
  ): Type {
    // First, check all field values to get their types
    const fieldValueTypes = new Map<string, Type>();
    const providedFields = new Set<string>();

    for (const field of expr.fields) {
      if (providedFields.has(field.name)) {
        this.checker.error(`duplicate field '${field.name}' in struct literal`, field.span);
        continue;
      }
      providedFields.add(field.name);

      if (!structType.fields.has(field.name)) {
        this.checker.error(`struct '${structType.name}' has no field '${field.name}'`, field.span);
        continue;
      }

      const valueType = this.checkExpression(field.value);
      fieldValueTypes.set(field.name, valueType);
    }

    // Check all required fields are present
    for (const [fieldName] of structType.fields) {
      if (!providedFields.has(fieldName)) {
        this.checker.error(
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
        this.extractTypeParamSubs(fieldType, valueType, subs);
      }
    }

    // Build instantiated struct type with recursive substitution
    const newFields = new Map<string, Type>();
    for (const [fieldName, fieldType] of structType.fields) {
      newFields.set(fieldName, this.substituteTypeParams(fieldType, subs));
    }

    const typeArgStrs = structType.genericParams.map((gp) => {
      const sub = subs.get(gp);
      return sub ? typeToString(sub) : gp;
    });

    return {
      kind: TypeKind.Struct,
      name: `${structType.name}<${typeArgStrs.join(", ")}>`,
      fields: newFields,
      methods: structType.methods,
      isUnsafe: structType.isUnsafe,
      genericParams: [],
    };
  }

  /** Recursively extract TypeParam→concrete type mappings by walking declared and concrete types. */
  private extractTypeParamSubs(declared: Type, concrete: Type, subs: Map<string, Type>): void {
    if (declared.kind === TypeKind.TypeParam) {
      if (!subs.has(declared.name)) {
        subs.set(declared.name, concrete);
      }
      return;
    }
    if (declared.kind !== concrete.kind) return;
    switch (declared.kind) {
      case TypeKind.Ptr:
        this.extractTypeParamSubs(declared.pointee, (concrete as PtrType).pointee, subs);
        break;
      case TypeKind.Array:
        this.extractTypeParamSubs(declared.element, (concrete as ArrayType).element, subs);
        break;
      case TypeKind.Slice:
        this.extractTypeParamSubs(declared.element, (concrete as SliceType).element, subs);
        break;
      case TypeKind.Range:
        this.extractTypeParamSubs(declared.element, (concrete as RangeType).element, subs);
        break;
      case TypeKind.Struct: {
        const concreteStruct = concrete as StructType;
        for (const [fieldName, fieldType] of declared.fields) {
          const concreteField = concreteStruct.fields.get(fieldName);
          if (concreteField) {
            this.extractTypeParamSubs(fieldType, concreteField, subs);
          }
        }
        break;
      }
    }
  }

  /** Recursively substitute TypeParam types using the given substitution map. */
  private substituteTypeParams(type: Type, subs: Map<string, Type>): Type {
    if (subs.size === 0) return type;
    switch (type.kind) {
      case TypeKind.TypeParam: {
        const sub = subs.get(type.name);
        return sub ?? type;
      }
      case TypeKind.Ptr:
        return ptrType(this.substituteTypeParams(type.pointee, subs));
      case TypeKind.Array:
        return { kind: TypeKind.Array, element: this.substituteTypeParams(type.element, subs) };
      case TypeKind.Slice:
        return { kind: TypeKind.Slice, element: this.substituteTypeParams(type.element, subs) };
      case TypeKind.Range:
        return rangeType(this.substituteTypeParams(type.element, subs));
      default:
        return type;
    }
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

  private checkIncrementExpression(expr: IncrementExpr): Type {
    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    if (!isIntegerType(operandType)) {
      this.checker.error(
        `increment operator requires integer type, got '${typeToString(operandType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    this.checkAssignTarget(expr.operand);
    return operandType;
  }

  private checkDecrementExpression(expr: DecrementExpr): Type {
    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    if (!isIntegerType(operandType)) {
      this.checker.error(
        `decrement operator requires integer type, got '${typeToString(operandType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    this.checkAssignTarget(expr.operand);
    return operandType;
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
}
