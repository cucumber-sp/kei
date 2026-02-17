/**
 * Expression lowering methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type {
  StructType,
  FunctionType,
} from "../checker/types.ts";
import type {
  Expression,
  ArrayLiteral,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  MemberExpr,
  IndexExpr,
  AssignExpr,
  StructLiteral,
  IntLiteral,
  FloatLiteral,
  StringLiteral,
  BoolLiteral,
  Identifier,
  IfExpr,
  IncrementExpr,
  DecrementExpr,
  MoveExpr,
  CatchExpr,
  ThrowExpr,
  CastExpr,
} from "../ast/nodes.ts";
import type {
  KirType,
  VarId,
  KirIntType,
  KirFloatType,
} from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

// ─── Expressions ─────────────────────────────────────────────────────────

export function lowerExpr(this: KirLowerer, expr: Expression): VarId {
  switch (expr.kind) {
    case "IntLiteral":
      return this.lowerIntLiteral(expr);
    case "FloatLiteral":
      return this.lowerFloatLiteral(expr);
    case "StringLiteral":
      return this.lowerStringLiteral(expr);
    case "BoolLiteral":
      return this.lowerBoolLiteral(expr);
    case "NullLiteral":
      return this.lowerNullLiteral();
    case "Identifier":
      return this.lowerIdentifier(expr);
    case "BinaryExpr":
      return this.lowerBinaryExpr(expr);
    case "UnaryExpr":
      return this.lowerUnaryExpr(expr);
    case "CallExpr":
      return this.lowerCallExpr(expr);
    case "MemberExpr":
      return this.lowerMemberExpr(expr);
    case "IndexExpr":
      return this.lowerIndexExpr(expr);
    case "AssignExpr":
      return this.lowerAssignExpr(expr);
    case "StructLiteral":
      return this.lowerStructLiteral(expr);
    case "IfExpr":
      return this.lowerIfExpr(expr);
    case "GroupExpr":
      return this.lowerExpr(expr.expression);
    case "IncrementExpr":
      return this.lowerIncrementExpr(expr);
    case "DecrementExpr":
      return this.lowerDecrementExpr(expr);
    case "MoveExpr":
      return this.lowerMoveExpr(expr);
    case "ThrowExpr":
      return this.lowerThrowExpr(expr);
    case "CatchExpr":
      return this.lowerCatchExpr(expr);
    case "CastExpr":
      return this.lowerCastExpr(expr);
    case "ArrayLiteral":
      return this.lowerArrayLiteral(expr);
    default:
      // Unhandled expression types return a placeholder
      return this.emitConstInt(0);
  }
}

export function lowerIntLiteral(this: KirLowerer, expr: IntLiteral): VarId {
  const dest = this.freshVar();
  const checkerType = this.checkResult.typeMap.get(expr);
  let type: KirIntType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "int") {
    type = { kind: "int", bits: checkerType.bits, signed: checkerType.signed };
  }
  this.emit({ kind: "const_int", dest, type, value: expr.value });
  return dest;
}

export function lowerFloatLiteral(this: KirLowerer, expr: FloatLiteral): VarId {
  const dest = this.freshVar();
  const checkerType = this.checkResult.typeMap.get(expr);
  let type: KirFloatType = { kind: "float", bits: 64 };
  if (checkerType?.kind === "float") {
    type = { kind: "float", bits: checkerType.bits };
  }
  this.emit({ kind: "const_float", dest, type, value: expr.value });
  return dest;
}

export function lowerStringLiteral(this: KirLowerer, expr: StringLiteral): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_string", dest, value: expr.value });
  return dest;
}

export function lowerBoolLiteral(this: KirLowerer, expr: BoolLiteral): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_bool", dest, value: expr.value });
  return dest;
}

export function lowerNullLiteral(this: KirLowerer): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_null", dest, type: { kind: "ptr", pointee: { kind: "void" } } });
  return dest;
}

/**
 * Lower an expression but return a pointer (alloc) instead of loading.
 * Used for struct field access where we need the base pointer for field_ptr.
 */
export function lowerExprAsPtr(this: KirLowerer, expr: Expression): VarId {
  if (expr.kind === "Identifier") {
    const varId = this.varMap.get(expr.name);
    if (varId) {
      if (this.isStackAllocVar(varId)) {
        return varId; // Return the alloc pointer directly
      }
      // For params (like self) that are already pointers to structs, return directly
      return varId;
    }
  }
  // For complex expressions like (a + b).x, lower the expression and wrap in alloc if needed
  const valueId = this.lowerExpr(expr);
  const exprType = this.checkResult.typeMap.get(expr);
  if (exprType?.kind === "struct") {
    const kirType = this.lowerCheckerType(exprType);
    const alloc = this.freshVar();
    this.emit({ kind: "stack_alloc", dest: alloc, type: kirType });
    this.emit({ kind: "store", ptr: alloc, value: valueId });
    return alloc;
  }
  return valueId;
}

export function lowerIdentifier(this: KirLowerer, expr: Identifier): VarId {
  const varId = this.varMap.get(expr.name);
  if (!varId) {
    // Could be a function name or unknown — just return a symbolic reference
    return `%${expr.name}`;
  }

  // If the var is a stack_alloc pointer, load it
  // Check if it's a param (params don't need loading)
  if (varId.startsWith("%") && this.isStackAllocVar(varId)) {
    const dest = this.freshVar();
    const type = this.getExprKirType(expr);
    this.emit({ kind: "load", dest, ptr: varId, type });
    return dest;
  }

  return varId;
}

export function lowerBinaryExpr(this: KirLowerer, expr: BinaryExpr): VarId {
  // Check for operator overloading
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.left, opMethod.methodName, opMethod.structType, [expr.right]);
  }

  // Short-circuit for logical AND/OR
  if (expr.operator === "&&") {
    return this.lowerShortCircuitAnd(expr);
  }
  if (expr.operator === "||") {
    return this.lowerShortCircuitOr(expr);
  }

  const lhs = this.lowerExpr(expr.left);
  const rhs = this.lowerExpr(expr.right);
  const dest = this.freshVar();

  const op = this.mapBinOp(expr.operator);
  if (op) {
    const type = this.getExprKirType(expr);
    // For string equality/inequality, pass operandType so the C emitter knows
    const leftCheckerType = this.checkResult.typeMap.get(expr.left);
    if (leftCheckerType?.kind === "string" && (op === "eq" || op === "neq")) {
      this.emit({ kind: "bin_op", op, dest, lhs, rhs, type, operandType: { kind: "string" } });
    } else {
      this.emit({ kind: "bin_op", op, dest, lhs, rhs, type });
    }
    return dest;
  }

  // Fallback
  return lhs;
}

export function lowerShortCircuitAnd(this: KirLowerer, expr: BinaryExpr): VarId {
  const lhs = this.lowerExpr(expr.left);
  const rhsLabel = this.freshBlockId("and.rhs");
  const endLabel = this.freshBlockId("and.end");

  this.setTerminator({ kind: "br", cond: lhs, thenBlock: rhsLabel, elseBlock: endLabel });

  this.sealCurrentBlock();
  this.startBlock(rhsLabel);
  const rhs = this.lowerExpr(expr.right);
  this.setTerminator({ kind: "jump", target: endLabel });

  this.sealCurrentBlock();
  this.startBlock(endLabel);

  // Without phi nodes, we use a stack_alloc + stores approach
  // For simplicity, just return rhs (correct when both paths converge)
  // In full SSA this would be a phi node
  return rhs;
}

export function lowerShortCircuitOr(this: KirLowerer, expr: BinaryExpr): VarId {
  const lhs = this.lowerExpr(expr.left);
  const rhsLabel = this.freshBlockId("or.rhs");
  const endLabel = this.freshBlockId("or.end");

  this.setTerminator({ kind: "br", cond: lhs, thenBlock: endLabel, elseBlock: rhsLabel });

  this.sealCurrentBlock();
  this.startBlock(rhsLabel);
  const rhs = this.lowerExpr(expr.right);
  this.setTerminator({ kind: "jump", target: endLabel });

  this.sealCurrentBlock();
  this.startBlock(endLabel);

  return lhs;
}

export function lowerUnaryExpr(this: KirLowerer, expr: UnaryExpr): VarId {
  // Check for operator overloading (e.g., -a → a.op_neg())
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.operand, opMethod.methodName, opMethod.structType, []);
  }

  const operand = this.lowerExpr(expr.operand);
  const dest = this.freshVar();

  switch (expr.operator) {
    case "-": {
      const type = this.getExprKirType(expr);
      this.emit({ kind: "neg", dest, operand, type });
      return dest;
    }
    case "!":
      this.emit({ kind: "not", dest, operand });
      return dest;
    case "~": {
      const type = this.getExprKirType(expr);
      this.emit({ kind: "bit_not", dest, operand, type });
      return dest;
    }
    default:
      return operand;
  }
}

/**
 * Emit a method call for an overloaded operator.
 * Lowers `self` and `args`, then emits: call StructName_methodName(self, ...args)
 */
export function lowerOperatorMethodCall(
  this: KirLowerer,
  selfExpr: Expression,
  methodName: string,
  structType: StructType,
  argExprs: Expression[],
): VarId {
  // Methods take self and args as pointers, so get alloc pointers, not loaded values
  const selfId = this.lowerExprAsPtr(selfExpr);
  const args = argExprs.map(a => {
    const argType = this.checkResult.typeMap.get(a);
    if (argType?.kind === "struct") {
      return this.lowerExprAsPtr(a);
    }
    return this.lowerExpr(a);
  });

  const funcName = `${structType.name}_${methodName}`;

  // Look up the method's return type
  const method = structType.methods.get(methodName);
  if (method && method.returnType.kind !== "void") {
    const resultType = this.lowerCheckerType(method.returnType);
    const dest = this.freshVar();
    this.emit({ kind: "call", dest, func: funcName, args: [selfId, ...args], type: resultType });

    // Struct return values are handled by the caller (variable assignment stores into alloc)

    return dest;
  }

  // Void return
  this.emit({ kind: "call_void", func: funcName, args: [selfId, ...args] });
  return selfId;
}

export function lowerCallExpr(this: KirLowerer, expr: CallExpr): VarId {
  // sizeof(Type) → KIR sizeof instruction (resolved by backend)
  if (expr.callee.kind === "Identifier" && expr.callee.name === "sizeof" && expr.args.length === 1) {
    const arg = expr.args[0];
    let kirType: KirType;
    if (arg && arg.kind === "Identifier") {
      kirType = this.lowerTypeNode({ kind: "NamedType", name: arg.name, span: arg.span });
    } else {
      kirType = { kind: "int", bits: 32, signed: true };
    }
    const dest = this.freshVar();
    this.emit({ kind: "sizeof", dest, type: kirType });
    return dest;
  }

  const args = expr.args.map((a) => this.lowerExpr(a));
  const resultType = this.getExprKirType(expr);
  const isVoid = resultType.kind === "void";

  // Get the function name
  let funcName: string;

  // Check for generic call resolution (e.g. max<i32>(a, b) → max_i32)
  const genericName = this.checkResult.genericResolutions.get(expr);
  if (genericName) {
    funcName = this.modulePrefix ? `${this.modulePrefix}_${genericName}` : genericName;
  } else if (expr.callee.kind === "Identifier") {
    const baseName = expr.callee.name;
    // Check if this is an imported function that needs module-prefixed name
    const importedName = this.importedNames.get(baseName);
    const resolvedBase = importedName ?? baseName;

    // Mangle overloaded function calls using the resolved callee type
    if (this.overloadedNames.has(baseName)) {
      const calleeType = this.checkResult.typeMap.get(expr.callee);
      if (calleeType && calleeType.kind === "function") {
        funcName = this.mangleFunctionNameFromType(resolvedBase, calleeType as FunctionType);
      } else {
        funcName = resolvedBase;
      }
    } else {
      funcName = resolvedBase;
    }
  } else if (expr.callee.kind === "MemberExpr") {
    // Check if this is a module-qualified call: module.function(args)
    const objType = this.checkResult.typeMap.get(expr.callee.object);
    if (objType?.kind === "module") {
      // Module-qualified call: math.add(args) → math_add(args)
      const modulePath = objType.name; // e.g., "math" or "net.http"
      const modulePrefix = modulePath.replace(/\./g, "_");
      const callName = expr.callee.property;
      const baseMangledName = `${modulePrefix}_${callName}`;

      // Check if the function is overloaded
      const calleeResolvedType = this.checkResult.typeMap.get(expr.callee);
      if (calleeResolvedType && calleeResolvedType.kind === "function") {
        if (this.overloadedNames.has(callName)) {
          funcName = this.mangleFunctionNameFromType(baseMangledName, calleeResolvedType as FunctionType);
        } else {
          funcName = baseMangledName;
        }
      } else {
        funcName = baseMangledName;
      }
    } else {
      // Instance method call: obj.method(args) → StructName_method(obj, args)
      const objId = this.lowerExpr(expr.callee.object);
      const methodName = expr.callee.property;

      if (objType?.kind === "struct") {
        funcName = `${objType.name}_${methodName}`;
      } else {
        funcName = methodName;
      }

      if (isVoid) {
        this.emit({ kind: "call_void", func: funcName, args: [objId, ...args] });
        return objId; // void calls return nothing meaningful
      }

      const dest = this.freshVar();
      this.emit({ kind: "call", dest, func: funcName, args: [objId, ...args], type: resultType });
      return dest;
    }
  } else {
    funcName = "<unknown>";
  }

  if (isVoid) {
    this.emit({ kind: "call_void", func: funcName, args });
    return this.emitConstInt(0); // void calls; return a dummy
  }

  const dest = this.freshVar();
  this.emit({ kind: "call", dest, func: funcName, args, type: resultType });
  return dest;
}

export function lowerMemberExpr(this: KirLowerer, expr: MemberExpr): VarId {
  // Handle .len on arrays — emit compile-time constant
  if (expr.property === "len") {
    const objectType = this.checkResult.typeMap.get(expr.object);
    if (objectType?.kind === "array" && objectType.length != null) {
      const dest = this.freshVar();
      this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 64, signed: false }, value: objectType.length });
      return dest;
    }
    // For strings, .len is a field access on the kei_string struct
    if (objectType?.kind === "string") {
      const baseId = this.lowerExpr(expr.object);
      const dest = this.freshVar();
      const resultType = this.getExprKirType(expr);
      const ptrDest = this.freshVar();
      this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: "len", type: resultType });
      this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
      return dest;
    }
  }

  // For struct field access, use the alloc pointer directly (not a loaded value).
  // This ensures the alloc is address-taken and won't be incorrectly promoted by mem2reg.
  let baseId: VarId;
  const objectType = this.checkResult.typeMap.get(expr.object);
  if (expr.object.kind === "Identifier" && objectType?.kind === "struct") {
    const varId = this.varMap.get(expr.object.name);
    if (varId && this.isStackAllocVar(varId)) {
      baseId = varId; // Use alloc pointer directly
    } else if (varId) {
      baseId = varId; // Param pointer
    } else {
      baseId = this.lowerExpr(expr.object);
    }
  } else if (expr.object.kind === "MemberExpr") {
    // Nested member access: first get the outer field as a pointer
    baseId = this.lowerExpr(expr.object);
  } else {
    baseId = this.lowerExpr(expr.object);
  }

  const dest = this.freshVar();
  const resultType = this.getExprKirType(expr);

  // Get pointer to field, then load
  const ptrDest = this.freshVar();
  this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: expr.property, type: resultType });
  this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
  return dest;
}

export function lowerIndexExpr(this: KirLowerer, expr: IndexExpr): VarId {
  // Check for operator overloading (e.g., obj[i] → obj.op_index(i))
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.object, opMethod.methodName, opMethod.structType, [expr.index]);
  }

  const baseId = this.lowerExpr(expr.object);
  const indexId = this.lowerExpr(expr.index);
  const resultType = this.getExprKirType(expr);

  // Emit bounds check for arrays with known length
  const objectType = this.checkResult.typeMap.get(expr.object);
  if (objectType?.kind === "array" && objectType.length != null) {
    const lenId = this.freshVar();
    this.emit({ kind: "const_int", dest: lenId, type: { kind: "int", bits: 64, signed: false }, value: objectType.length });
    this.emit({ kind: "bounds_check", index: indexId, length: lenId });
  }

  const ptrDest = this.freshVar();
  this.emit({ kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: resultType });

  const dest = this.freshVar();
  this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
  return dest;
}

export function lowerAssignExpr(this: KirLowerer, expr: AssignExpr): VarId {
  // Check for operator overloading: obj[i] = v → obj.op_index_set(i, v)
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod && expr.target.kind === "IndexExpr") {
    return this.lowerOperatorMethodCall(
      expr.target.object,
      opMethod.methodName,
      opMethod.structType,
      [expr.target.index, expr.value],
    );
  }

  const valueId = this.lowerExpr(expr.value);

  if (expr.target.kind === "Identifier") {
    const ptrId = this.varMap.get(expr.target.name);
    if (ptrId) {
      // Handle compound assignment operators
      if (expr.operator !== "=") {
        const op = this.mapCompoundAssignOp(expr.operator);
        if (op) {
          const currentVal = this.freshVar();
          const type = this.getExprKirType(expr.target);
          this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
          const result = this.freshVar();
          this.emit({ kind: "bin_op", op, dest: result, lhs: currentVal, rhs: valueId, type });
          this.emit({ kind: "store", ptr: ptrId, value: result });
          return result;
        }
      }

      // For simple assignment to struct with lifecycle: destroy old, store new, oncopy new
      const checkerType = this.checkResult.typeMap.get(expr.target);
      const lifecycle = this.getStructLifecycle(checkerType);
      if (lifecycle?.hasDestroy) {
        // Load old value and destroy it
        const oldVal = this.freshVar();
        const type = this.getExprKirType(expr.target);
        this.emit({ kind: "load", dest: oldVal, ptr: ptrId, type });
        this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
      }

      this.emit({ kind: "store", ptr: ptrId, value: valueId });

      // Oncopy the new value (unless it's a move)
      if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
        this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    }
  } else if (expr.target.kind === "MemberExpr") {
    const baseId = this.lowerExpr(expr.target.object);
    const ptrDest = this.freshVar();
    const fieldType = this.getExprKirType(expr.target);
    this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: expr.target.property, type: fieldType });

    // Destroy old field value if it has lifecycle hooks
    const checkerType = this.checkResult.typeMap.get(expr.target);
    const lifecycle = this.getStructLifecycle(checkerType);
    if (lifecycle?.hasDestroy) {
      const oldVal = this.freshVar();
      this.emit({ kind: "load", dest: oldVal, ptr: ptrDest, type: fieldType });
      this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
    }

    this.emit({ kind: "store", ptr: ptrDest, value: valueId });

    if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
      this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
    }
  } else if (expr.target.kind === "IndexExpr") {
    const baseId = this.lowerExpr(expr.target.object);
    const indexId = this.lowerExpr(expr.target.index);
    const elemType = this.getExprKirType(expr.target);
    const ptrDest = this.freshVar();
    this.emit({ kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: elemType });
    this.emit({ kind: "store", ptr: ptrDest, value: valueId });
  }

  return valueId;
}

export function lowerStructLiteral(this: KirLowerer, expr: StructLiteral): VarId {
  const type = this.getExprKirType(expr);
  const ptrId = this.freshVar();
  this.emit({ kind: "stack_alloc", dest: ptrId, type });

  for (const field of expr.fields) {
    const valueId = this.lowerExpr(field.value);
    const fieldPtrId = this.freshVar();
    const fieldType = this.getExprKirType(field.value);
    this.emit({ kind: "field_ptr", dest: fieldPtrId, base: ptrId, field: field.name, type: fieldType });
    this.emit({ kind: "store", ptr: fieldPtrId, value: valueId });
  }

  return ptrId;
}

export function lowerArrayLiteral(this: KirLowerer, expr: ArrayLiteral): VarId {
  const checkerType = this.checkResult.typeMap.get(expr);
  let elemType: KirType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "array") {
    elemType = this.lowerCheckerType(checkerType.element);
  }

  const arrType: KirType = { kind: "array", element: elemType, length: expr.elements.length };
  const ptrId = this.freshVar();
  this.emit({ kind: "stack_alloc", dest: ptrId, type: arrType });

  // Store each element at its index
  for (let i = 0; i < expr.elements.length; i++) {
    const valueId = this.lowerExpr(expr.elements[i]!);
    const idxId = this.freshVar();
    this.emit({ kind: "const_int", dest: idxId, type: { kind: "int", bits: 64, signed: false }, value: i });
    const elemPtrId = this.freshVar();
    this.emit({ kind: "index_ptr", dest: elemPtrId, base: ptrId, index: idxId, type: elemType });
    this.emit({ kind: "store", ptr: elemPtrId, value: valueId });
  }

  return ptrId;
}

export function lowerIfExpr(this: KirLowerer, expr: IfExpr): VarId {
  const condId = this.lowerExpr(expr.condition);
  const resultType = this.getExprKirType(expr);

  const thenLabel = this.freshBlockId("ifexpr.then");
  const elseLabel = this.freshBlockId("ifexpr.else");
  const endLabel = this.freshBlockId("ifexpr.end");

  // Allocate result on stack
  const resultPtr = this.freshVar();
  this.emit({ kind: "stack_alloc", dest: resultPtr, type: resultType });

  this.setTerminator({ kind: "br", cond: condId, thenBlock: thenLabel, elseBlock: elseLabel });

  // Then
  this.sealCurrentBlock();
  this.startBlock(thenLabel);
  const thenStmts = expr.thenBlock.statements;
  for (const s of thenStmts) {
    if (s.kind === "ExprStmt") {
      const val = this.lowerExpr(s.expression);
      this.emit({ kind: "store", ptr: resultPtr, value: val });
    } else {
      this.lowerStatement(s);
    }
  }
  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // Else
  this.sealCurrentBlock();
  this.startBlock(elseLabel);
  const elseStmts = expr.elseBlock.statements;
  for (const s of elseStmts) {
    if (s.kind === "ExprStmt") {
      const val = this.lowerExpr(s.expression);
      this.emit({ kind: "store", ptr: resultPtr, value: val });
    } else {
      this.lowerStatement(s);
    }
  }
  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // End
  this.sealCurrentBlock();
  this.startBlock(endLabel);

  const dest = this.freshVar();
  this.emit({ kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

export function lowerIncrementExpr(this: KirLowerer, expr: IncrementExpr): VarId {
  if (expr.operand.kind === "Identifier") {
    const ptrId = this.varMap.get(expr.operand.name);
    if (ptrId) {
      const type = this.getExprKirType(expr.operand);
      const currentVal = this.freshVar();
      this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
      const oneId = this.emitConstInt(1);
      const result = this.freshVar();
      this.emit({ kind: "bin_op", op: "add", dest: result, lhs: currentVal, rhs: oneId, type });
      this.emit({ kind: "store", ptr: ptrId, value: result });
      return currentVal; // post-increment: return old value
    }
  }
  return this.emitConstInt(0);
}

export function lowerDecrementExpr(this: KirLowerer, expr: DecrementExpr): VarId {
  if (expr.operand.kind === "Identifier") {
    const ptrId = this.varMap.get(expr.operand.name);
    if (ptrId) {
      const type = this.getExprKirType(expr.operand);
      const currentVal = this.freshVar();
      this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
      const oneId = this.emitConstInt(1);
      const result = this.freshVar();
      this.emit({ kind: "bin_op", op: "sub", dest: result, lhs: currentVal, rhs: oneId, type });
      this.emit({ kind: "store", ptr: ptrId, value: result });
      return currentVal; // post-decrement: return old value
    }
  }
  return this.emitConstInt(0);
}

export function lowerMoveExpr(this: KirLowerer, expr: MoveExpr): VarId {
  const sourceId = this.lowerExpr(expr.operand);
  const dest = this.freshVar();
  const type = this.getExprKirType(expr.operand);
  this.emit({ kind: "move", dest, source: sourceId, type });

  // Mark the source variable as moved so it won't be destroyed at scope exit
  if (expr.operand.kind === "Identifier") {
    this.movedVars.add(expr.operand.name);
  }

  return dest;
}

export function lowerCastExpr(this: KirLowerer, expr: CastExpr): VarId {
  const value = this.lowerExpr(expr.operand);
  const targetType = this.getExprKirType(expr);
  const dest = this.freshVar();
  this.emit({ kind: "cast", dest, value, targetType });
  return dest;
}

export function lowerThrowExpr(this: KirLowerer, expr: ThrowExpr): VarId {
  // throw ErrorType{} → cast __err to typed pointer, store error value, return error tag
  const valueId = this.lowerExpr(expr.value);
  const errPtr = this.varMap.get("__err")!;

  // Determine the error type for casting
  const errorKirType = this.getExprKirType(expr.value);

  // Only copy error data if the struct has fields (skip for empty structs)
  const hasFields = errorKirType.kind === "struct" && errorKirType.fields.length > 0;
  if (hasFields) {
    // Cast __err (void*) to the specific error struct pointer type
    const typedErrPtr = this.freshVar();
    this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: errorKirType } });

    // The struct literal returns a pointer; load the actual struct value from it
    const structVal = this.freshVar();
    this.emit({ kind: "load", dest: structVal, ptr: valueId, type: errorKirType });

    // Store the struct value through the typed error pointer
    this.emit({ kind: "store", ptr: typedErrPtr, value: structVal });
  }

  // Determine the tag for this error type
  const checkerType = this.checkResult.typeMap.get(expr.value);
  let tag = 1; // default
  if (checkerType && checkerType.kind === "struct") {
    const idx = this.currentFunctionThrowsTypes.findIndex(
      t => t.kind === "struct" && t.name === checkerType.name
    );
    if (idx >= 0) tag = idx + 1;
  }

  this.emitAllScopeDestroys();
  const tagVal = this.emitConstInt(tag);
  this.setTerminator({ kind: "ret", value: tagVal });
  return tagVal;
}

export function lowerCatchExpr(this: KirLowerer, expr: CatchExpr): VarId {
  // The operand must be a function call to a throws function
  // We need to resolve the callee's throws info to generate the right code

  // Resolve the function name and its throws info
  const callExpr = expr.operand;
  const throwsInfo = this.resolveCallThrowsInfo(callExpr);
  if (!throwsInfo) {
    // Fallback: just lower the operand normally
    return this.lowerExpr(expr.operand);
  }

  const { funcName, args: callArgs, throwsTypes, returnType: successType } = throwsInfo;

  // Allocate buffers for out value and error value
  const outPtr = this.freshVar();
  const errPtr = this.freshVar();
  const outType = successType.kind === "void"
    ? { kind: "int" as const, bits: 8 as const, signed: false as const }
    : successType;
  this.emit({ kind: "stack_alloc", dest: outPtr, type: outType });
  // err buffer: use u8 placeholder (C backend will emit union-sized buffer)
  this.emit({ kind: "stack_alloc", dest: errPtr, type: { kind: "int", bits: 8, signed: false } });

  // Call the throws function — dest receives the i32 tag
  const tagVar = this.freshVar();
  this.emit({
    kind: "call_throws",
    dest: tagVar,
    func: funcName,
    args: callArgs,
    outPtr,
    errPtr,
    successType,
    errorTypes: throwsTypes,
  });

  if (expr.catchType === "panic") {
    // catch panic: if tag != 0 → kei_panic
    const zeroConst = this.emitConstInt(0);
    const isOk = this.freshVar();
    this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });
    const okLabel = this.freshBlockId("catch.ok");
    const panicLabel = this.freshBlockId("catch.panic");
    this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: panicLabel });

    this.sealCurrentBlock();
    this.startBlock(panicLabel);
    // Call kei_panic
    const panicMsg = this.freshVar();
    this.emit({ kind: "const_string", dest: panicMsg, value: "unhandled error" });
    this.emit({ kind: "call_extern_void", func: "kei_panic", args: [panicMsg] });
    this.setTerminator({ kind: "unreachable" });

    this.sealCurrentBlock();
    this.startBlock(okLabel);

    // Load and return the success value
    if (successType.kind === "void") {
      return this.emitConstInt(0);
    }
    const resultVal = this.freshVar();
    this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  if (expr.catchType === "throw") {
    // catch throw: pass caller's __err directly so callee writes to it
    // Re-emit the call with the caller's __err pointer
    // Remove the previous call_throws (it was the last emitted instruction)
    this.currentInsts.pop(); // remove the call_throws we just emitted

    const callerErrPtr = this.varMap.get("__err")!;
    this.emit({
      kind: "call_throws",
      dest: tagVar,
      func: funcName,
      args: callArgs,
      outPtr,
      errPtr: callerErrPtr, // pass caller's err buffer directly
      successType,
      errorTypes: throwsTypes,
    });

    const zeroConst = this.emitConstInt(0);
    const isOk = this.freshVar();
    this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });
    const okLabel = this.freshBlockId("catch.ok");
    const propagateLabel = this.freshBlockId("catch.throw");
    this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: propagateLabel });

    this.sealCurrentBlock();
    this.startBlock(propagateLabel);

    // Remap tags from callee to caller's tag space and propagate
    this.lowerCatchThrowPropagation(throwsTypes, tagVar, callerErrPtr);

    this.sealCurrentBlock();
    this.startBlock(okLabel);

    if (successType.kind === "void") {
      return this.emitConstInt(0);
    }
    const resultVal = this.freshVar();
    this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  // catch { clauses } — block catch with per-error-type handling
  const zeroConst = this.emitConstInt(0);
  const isOk = this.freshVar();
  this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });

  const okLabel = this.freshBlockId("catch.ok");
  const switchLabel = this.freshBlockId("catch.switch");
  const endLabel = this.freshBlockId("catch.end");
  this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: switchLabel });

  // Allocate result storage (the catch expr produces a value)
  const resultType = this.getExprKirType(expr);
  const resultPtr = this.freshVar();
  this.emit({ kind: "stack_alloc", dest: resultPtr, type: resultType });

  // Switch block: branch on tag value
  this.sealCurrentBlock();
  this.startBlock(switchLabel);

  // Build case blocks for each clause
  const caseInfos: { tagConst: VarId; label: string }[] = [];

  for (const clause of expr.clauses) {
    if (clause.isDefault) continue; // handle default separately

    // Find the tag for this error type
    const errorTag = throwsTypes.findIndex(
      t => t.kind === "struct" && t.name === clause.errorType
    ) + 1;

    const clauseLabel = this.freshBlockId(`catch.clause.${clause.errorType}`);
    const tagConstVar = this.emitConstInt(errorTag);
    caseInfos.push({ tagConst: tagConstVar, label: clauseLabel });
  }

  // Default block (unreachable or user default clause)
  const defaultClause = expr.clauses.find(c => c.isDefault);
  const defaultLabel = defaultClause
    ? this.freshBlockId("catch.default")
    : this.freshBlockId("catch.unreachable");

  this.setTerminator({
    kind: "switch",
    value: tagVar,
    cases: caseInfos.map(ci => ({ value: ci.tagConst, target: ci.label })),
    defaultBlock: defaultLabel,
  });

  // Emit each clause block
  for (const clause of expr.clauses) {
    if (clause.isDefault) continue;

    const errorTag = throwsTypes.findIndex(
      t => t.kind === "struct" && t.name === clause.errorType
    ) + 1;
    const clauseLabel = caseInfos.find(ci => {
      // Match by tag value
      const inst = this.findConstIntInst(ci.tagConst);
      return inst?.value === errorTag;
    })?.label;
    if (!clauseLabel) continue;

    this.sealCurrentBlock();
    this.startBlock(clauseLabel);

    // If clause has a variable name, bind it to the error value in the err buffer
    if (clause.varName) {
      const errType = throwsTypes[errorTag - 1];
      // Cast errPtr to typed pointer — this becomes the variable's storage
      const typedErrPtr = this.freshVar();
      this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: errType } });
      this.varMap.set(clause.varName, typedErrPtr);
    }

    // Lower clause body statements
    for (const stmt of clause.body) {
      this.lowerStatement(stmt);
    }

    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }
  }

  // Default clause block
  this.sealCurrentBlock();
  this.startBlock(defaultLabel);
  if (defaultClause) {
    if (defaultClause.varName) {
      // Bind the error variable to a typed pointer into the err buffer
      const firstErrType = throwsTypes[0] || { kind: "int" as const, bits: 8 as const, signed: false as const };
      const typedErrPtr = this.freshVar();
      this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: firstErrType } });
      this.varMap.set(defaultClause.varName, typedErrPtr);
    }
    for (const stmt of defaultClause.body) {
      this.lowerStatement(stmt);
    }
  }
  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // OK path: load success value
  this.sealCurrentBlock();
  this.startBlock(okLabel);
  if (successType.kind !== "void") {
    const successVal = this.freshVar();
    this.emit({ kind: "load", dest: successVal, ptr: outPtr, type: successType });
    this.emit({ kind: "store", ptr: resultPtr, value: successVal });
  }
  this.setTerminator({ kind: "jump", target: endLabel });

  // End block
  this.sealCurrentBlock();
  this.startBlock(endLabel);

  if (resultType.kind === "void") {
    return this.emitConstInt(0);
  }
  const finalResult = this.freshVar();
  this.emit({ kind: "load", dest: finalResult, ptr: resultPtr, type: resultType });
  return finalResult;
}

/** Resolve the function name, args, and throws info for a call expression used in catch */
export function resolveCallThrowsInfo(this: KirLowerer, callExpr: Expression): {
  funcName: string;
  args: VarId[];
  throwsTypes: KirType[];
  returnType: KirType;
} | null {
  if (callExpr.kind !== "CallExpr") return null;

  const args = callExpr.args.map(a => this.lowerExpr(a));
  const resultType = this.getExprKirType(callExpr);

  // Resolve function name (same logic as lowerCallExpr)
  let funcName: string;
  if (callExpr.callee.kind === "Identifier") {
    const baseName = callExpr.callee.name;
    const importedName = this.importedNames.get(baseName);
    const resolvedBase = importedName ?? baseName;

    if (this.overloadedNames.has(baseName)) {
      const calleeType = this.checkResult.typeMap.get(callExpr.callee);
      if (calleeType && calleeType.kind === "function") {
        funcName = this.mangleFunctionNameFromType(resolvedBase, calleeType as FunctionType);
      } else {
        funcName = resolvedBase;
      }
    } else {
      funcName = resolvedBase;
    }
  } else if (callExpr.callee.kind === "MemberExpr") {
    const objType = this.checkResult.typeMap.get(callExpr.callee.object);
    if (objType?.kind === "module") {
      const modulePrefix = objType.name.replace(/\./g, "_");
      funcName = `${modulePrefix}_${callExpr.callee.property}`;
    } else {
      funcName = callExpr.callee.property;
    }
  } else {
    return null;
  }

  // Look up throws info from pre-registered throws functions
  const throwsInfo = this.throwsFunctions.get(funcName);
  if (throwsInfo) {
    return {
      funcName,
      args,
      throwsTypes: throwsInfo.throwsTypes,
      returnType: throwsInfo.returnType,
    };
  }

  // Fallback: try to get from checker's type info
  const calleeType = this.checkResult.typeMap.get(callExpr.callee);
  if (calleeType && calleeType.kind === "function" && (calleeType as FunctionType).throwsTypes.length > 0) {
    const ft = calleeType as FunctionType;
    return {
      funcName,
      args,
      throwsTypes: ft.throwsTypes.map(t => this.lowerCheckerType(t)),
      returnType: this.lowerCheckerType(ft.returnType),
    };
  }

  return null;
}

/** For catch throw: propagate errors from callee to caller's error protocol.
 *  The callee already wrote the error value to the caller's __err buffer,
 *  so we only need to remap tags if the error type ordering differs. */
export function lowerCatchThrowPropagation(this: KirLowerer, calleeThrowsTypes: KirType[], tagVar: VarId, _errPtr: VarId): void {
  const callerThrowsTypes = this.currentFunctionThrowsTypes;

  // Check if all callee types exist in caller types at same indices
  let needsRemap = false;
  for (let i = 0; i < calleeThrowsTypes.length; i++) {
    const calleeType = calleeThrowsTypes[i];
    const callerIdx = callerThrowsTypes.findIndex(
      ct => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
    );
    if (callerIdx !== i) {
      needsRemap = true;
      break;
    }
  }

  if (!needsRemap) {
    // Direct propagation: same tag numbering, error already in caller's buffer
    this.emitAllScopeDestroys();
    this.setTerminator({ kind: "ret", value: tagVar });
  } else {
    // Remap: switch on callee tag, return caller's tag
    const cases: { value: VarId; target: string }[] = [];
    const endPropLabel = this.freshBlockId("catch.prop.end");

    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeTag = this.emitConstInt(i + 1);
      const caseLabel = this.freshBlockId(`catch.prop.${i}`);
      cases.push({ value: calleeTag, target: caseLabel });
    }

    this.setTerminator({
      kind: "switch",
      value: tagVar,
      cases,
      defaultBlock: endPropLabel,
    });

    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeType = calleeThrowsTypes[i];
      const callerIdx = callerThrowsTypes.findIndex(
        ct => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
      );
      if (callerIdx < 0) continue;

      this.sealCurrentBlock();
      this.startBlock(cases[i].target);
      this.emitAllScopeDestroys();
      const callerTag = this.emitConstInt(callerIdx + 1);
      this.setTerminator({ kind: "ret", value: callerTag });
    }

    this.sealCurrentBlock();
    this.startBlock(endPropLabel);
    this.setTerminator({ kind: "unreachable" });
  }
}

/** Find a const_int instruction by its dest VarId (for tag matching) */
export function findConstIntInst(this: KirLowerer, varId: VarId): { value: number } | null {
  for (const block of this.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "const_int" && inst.dest === varId) {
        return { value: inst.value };
      }
    }
  }
  for (const inst of this.currentInsts) {
    if (inst.kind === "const_int" && inst.dest === varId) {
      return { value: inst.value };
    }
  }
  return null;
}
