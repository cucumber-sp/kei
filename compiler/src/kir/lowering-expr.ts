/**
 * Expression lowering methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 *
 * Additional expression categories are split into:
 *   - lowering-literals.ts   (literal and composite expressions)
 *   - lowering-operators.ts  (binary, unary, increment, decrement operators)
 *   - lowering-error.ts      (throw/catch error handling)
 */

import type {
  AssignExpr,
  CallExpr,
  CastExpr,
  Expression,
  Identifier,
  IfExpr,
  IndexExpr,
  MemberExpr,
  MoveExpr,
  Statement,
  SwitchExpr,
} from "../ast/nodes.ts";
import type { FunctionType } from "../checker/types";
import type { KirType, VarId } from "./kir-types.ts";
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
    case "SwitchExpr":
      return this.lowerSwitchExpr(expr);
    default:
      // Unhandled expression types return a placeholder
      return this.emitConstInt(0);
  }
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
    const alloc = this.emitStackAlloc(kirType);
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

export function lowerCallExpr(this: KirLowerer, expr: CallExpr): VarId {
  // Enum variant construction: Shape.Circle(3.14) → stack_alloc + tag + data fields
  if (expr.callee.kind === "MemberExpr") {
    const calleeType = this.checkResult.typeMap.get(expr.callee.object);
    if (calleeType?.kind === "enum") {
      const enumType = calleeType;
      const variantName = expr.callee.property;
      const variantIndex = enumType.variants.findIndex((v) => v.name === variantName);
      if (variantIndex >= 0) {
        const variant = enumType.variants[variantIndex];
        const tagValue = variant.value ?? variantIndex;
        const kirEnumType = this.lowerCheckerType(enumType);

        // stack_alloc the tagged union struct
        const ptrId = this.emitStackAlloc(kirEnumType);

        // Set tag field
        const tagPtrId = this.freshVar();
        this.emit({
          kind: "field_ptr",
          dest: tagPtrId,
          base: ptrId,
          field: "tag",
          type: { kind: "int", bits: 32, signed: true },
        });
        const tagVal = this.freshVar();
        this.emit({
          kind: "const_int",
          dest: tagVal,
          type: { kind: "int", bits: 32, signed: true },
          value: tagValue,
        });
        this.emit({ kind: "store", ptr: tagPtrId, value: tagVal });

        // Set data fields: data.VariantName.fieldName
        for (let i = 0; i < expr.args.length; i++) {
          const arg = expr.args[i];
          if (!arg) continue;
          const valueId = this.lowerExpr(arg);
          const field = variant.fields[i];
          if (!field) continue;
          const fieldType = this.lowerCheckerType(field.type);
          const fieldPtrId = this.freshVar();
          this.emit({
            kind: "field_ptr",
            dest: fieldPtrId,
            base: ptrId,
            field: `data.${variantName}.${field.name}`,
            type: fieldType,
          });
          this.emit({ kind: "store", ptr: fieldPtrId, value: valueId });
        }

        return ptrId;
      }
    }
  }

  // sizeof(Type) → KIR sizeof instruction (resolved by backend)
  if (
    expr.callee.kind === "Identifier" &&
    expr.callee.name === "sizeof" &&
    expr.args.length === 1
  ) {
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
  const genericName = this.currentBodyGenericResolutions?.get(expr) ?? this.checkResult.genericResolutions.get(expr);
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
          funcName = this.mangleFunctionNameFromType(
            baseMangledName,
            calleeResolvedType as FunctionType
          );
        } else {
          funcName = baseMangledName;
        }
      } else {
        funcName = baseMangledName;
      }
    } else {
      // Instance method call: obj.method(args) → StructName_method(obj, args)
      // Methods expect self as a pointer, so use lowerExprAsPtr for struct objects
      const objId = objType?.kind === "struct"
        ? this.lowerExprAsPtr(expr.callee.object)
        : this.lowerExpr(expr.callee.object);
      const methodName = expr.callee.property;

      if (objType?.kind === "struct") {
        funcName = `${objType.name}_${methodName}`;
      } else {
        funcName = methodName;
      }

      // Methods wrap struct params in ptr<>, so re-lower struct args as pointers.
      // The `args` array already lowered them as values; for struct args, we need
      // to wrap the already-lowered value into a stack_alloc + store to get a pointer.
      const methodArgs = args.map((argId, i) => {
        const argExpr = expr.args[i];
        const argType = argExpr ? this.checkResult.typeMap.get(argExpr) : undefined;
        if (argType?.kind === "struct") {
          const kirType = this.lowerCheckerType(argType);
          const alloc = this.emitStackAlloc(kirType);
          this.emit({ kind: "store", ptr: alloc, value: argId });
          return alloc;
        }
        return argId;
      });

      if (isVoid) {
        this.emit({ kind: "call_void", func: funcName, args: [objId, ...methodArgs] });
        return objId; // void calls return nothing meaningful
      }

      const dest = this.freshVar();
      this.emit({ kind: "call", dest, func: funcName, args: [objId, ...methodArgs], type: resultType });
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
      this.emit({
        kind: "const_int",
        dest,
        type: { kind: "int", bits: 64, signed: false },
        value: objectType.length,
      });
      return dest;
    }
    // For strings, .len is a field access on the kei_string struct
    if (objectType?.kind === "string") {
      const baseId = this.lowerExpr(expr.object);
      const resultType = this.getExprKirType(expr);
      return this.emitFieldLoad(baseId, "len", resultType);
    }
  }

  // Handle enum variant access — emit the variant's integer discriminant
  const objectType = this.checkResult.typeMap.get(expr.object);
  if (objectType?.kind === "enum") {
    const variantIndex = objectType.variants.findIndex((v) => v.name === expr.property);
    if (variantIndex >= 0) {
      const variant = objectType.variants[variantIndex];
      const value = variant.value ?? variantIndex;
      const hasDataVariants = objectType.variants.some((v) => v.fields.length > 0);

      if (hasDataVariants) {
        // Tagged union enum: construct full struct with tag set (no data fields for fieldless variant)
        const kirEnumType = this.lowerCheckerType(objectType);
        const ptrId = this.emitStackAlloc(kirEnumType);

        const tagPtrId = this.freshVar();
        this.emit({
          kind: "field_ptr",
          dest: tagPtrId,
          base: ptrId,
          field: "tag",
          type: { kind: "int", bits: 32, signed: true },
        });
        const tagVal = this.freshVar();
        this.emit({
          kind: "const_int",
          dest: tagVal,
          type: { kind: "int", bits: 32, signed: true },
          value,
        });
        this.emit({ kind: "store", ptr: tagPtrId, value: tagVal });

        return ptrId;
      }

      // Simple enum: just emit the integer discriminant
      const dest = this.freshVar();
      this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
      return dest;
    }
  }

  // For struct field access, use the alloc pointer directly (not a loaded value).
  // This ensures the alloc is address-taken and won't be incorrectly promoted by mem2reg.
  let baseId: VarId;
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

  const resultType = this.getExprKirType(expr);
  return this.emitFieldLoad(baseId, expr.property, resultType);
}

export function lowerIndexExpr(this: KirLowerer, expr: IndexExpr): VarId {
  // Check for operator overloading (e.g., obj[i] → obj.op_index(i))
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.object, opMethod.methodName, opMethod.structType, [
      expr.index,
    ]);
  }

  const baseId = this.lowerExpr(expr.object);
  const indexId = this.lowerExpr(expr.index);
  const resultType = this.getExprKirType(expr);

  // Emit bounds check for arrays with known length
  const objectType = this.checkResult.typeMap.get(expr.object);
  if (objectType?.kind === "array" && objectType.length != null) {
    const lenId = this.freshVar();
    this.emit({
      kind: "const_int",
      dest: lenId,
      type: { kind: "int", bits: 64, signed: false },
      value: objectType.length,
    });
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
      [expr.target.index, expr.value]
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

      // For simple assignment to managed type: destroy old, store new, oncopy new
      const checkerType = this.checkResult.typeMap.get(expr.target);
      const lifecycle = this.getStructLifecycle(checkerType);
      if (lifecycle?.hasDestroy) {
        // Load old value and destroy it
        const oldVal = this.freshVar();
        const type = this.getExprKirType(expr.target);
        this.emit({ kind: "load", dest: oldVal, ptr: ptrId, type });
        this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
      } else if (checkerType?.kind === "string") {
        // String: call kei_string_destroy on the pointer to the old value
        this.emit({ kind: "call_extern_void", func: "kei_string_destroy", args: [ptrId] });
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
    this.emit({
      kind: "field_ptr",
      dest: ptrDest,
      base: baseId,
      field: expr.target.property,
      type: fieldType,
    });

    // Destroy old field value if it has lifecycle hooks
    const checkerType = this.checkResult.typeMap.get(expr.target);
    const lifecycle = this.getStructLifecycle(checkerType);
    if (lifecycle?.hasDestroy) {
      const oldVal = this.freshVar();
      this.emit({ kind: "load", dest: oldVal, ptr: ptrDest, type: fieldType });
      this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
    } else if (checkerType?.kind === "string") {
      // String field: call kei_string_destroy on the pointer to the old value
      this.emit({ kind: "call_extern_void", func: "kei_string_destroy", args: [ptrDest] });
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

    // Destroy old element value if it's a managed type
    const checkerType = this.checkResult.typeMap.get(expr.target);
    const lifecycle = this.getStructLifecycle(checkerType);
    if (lifecycle?.hasDestroy) {
      const oldVal = this.freshVar();
      this.emit({ kind: "load", dest: oldVal, ptr: ptrDest, type: elemType });
      this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
    } else if (checkerType?.kind === "string") {
      this.emit({ kind: "call_extern_void", func: "kei_string_destroy", args: [ptrDest] });
    }

    this.emit({ kind: "store", ptr: ptrDest, value: valueId });
  }

  return valueId;
}

export function lowerIfExpr(this: KirLowerer, expr: IfExpr): VarId {
  const condId = this.lowerExpr(expr.condition);
  const resultType = this.getExprKirType(expr);

  const thenLabel = this.freshBlockId("ifexpr.then");
  const elseLabel = this.freshBlockId("ifexpr.else");
  const endLabel = this.freshBlockId("ifexpr.end");

  // Allocate result on stack
  const resultPtr = this.emitStackAlloc(resultType);

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

export function lowerSwitchExpr(this: KirLowerer, expr: SwitchExpr): VarId {
  const subjectId = this.lowerExpr(expr.subject);
  const resultType = this.getExprKirType(expr);
  const endLabel = this.freshBlockId("switchexpr.end");

  // Allocate result on stack
  const resultPtr = this.emitStackAlloc(resultType);

  const caseLabels: { value: VarId; target: string }[] = [];
  let defaultLabel = endLabel;
  const caseBlocks: { label: string; stmts: Statement[] }[] = [];

  for (const c of expr.cases) {
    const label = c.isDefault
      ? this.freshBlockId("switchexpr.default")
      : this.freshBlockId("switchexpr.case");

    if (c.isDefault) {
      defaultLabel = label;
    }

    for (const val of c.values) {
      const valId = this.lowerExpr(val);
      caseLabels.push({ value: valId, target: label });
    }

    caseBlocks.push({ label, stmts: c.body });
  }

  this.setTerminator({
    kind: "switch",
    value: subjectId,
    cases: caseLabels,
    defaultBlock: defaultLabel,
  });

  // Emit case blocks — store last expression value into resultPtr
  for (const cb of caseBlocks) {
    this.sealCurrentBlock();
    this.startBlock(cb.label);
    for (const s of cb.stmts) {
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
  }

  // End block — load and return result
  this.sealCurrentBlock();
  this.startBlock(endLabel);

  const dest = this.freshVar();
  this.emit({ kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
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
