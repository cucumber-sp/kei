/**
 * Expression lowering — operates on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 *
 * Additional expression categories are split into:
 *   - lowering-literals.ts   (literal and composite expressions)
 *   - lowering-operators.ts  (binary, unary, increment, decrement operators)
 *   - lowering-error.ts      (throw/catch error handling)
 *   - lowering-switch.ts     (switch expression lowering)
 *   - lowering-enum.ts       (enum variant construction and access)
 */

import type {
  AssignExpr,
  CallExpr,
  CastExpr,
  DerefExpr,
  Expression,
  Identifier,
  IfExpr,
  IndexExpr,
  MemberExpr,
  MoveExpr,
  TypeNode,
  UnsafeExpr,
} from "../ast/nodes";
import type { FunctionType } from "../checker/types";
import type { KirType, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { lowerEnumVariantAccess, lowerEnumVariantConstruction } from "./lowering-enum";
import { lowerCatchExpr, lowerThrowExpr } from "./lowering-error";
import {
  lowerArrayLiteral,
  lowerBoolLiteral,
  lowerFloatLiteral,
  lowerIntLiteral,
  lowerNullLiteral,
  lowerStringLiteral,
  lowerStructLiteral,
} from "./lowering-literals";
import { lowerBinaryExpr, lowerOperatorMethodCall, lowerUnaryExpr } from "./lowering-operators";
import { getStructLifecycle, popScopeWithDestroy, pushScope } from "./lowering-scope";
import { lowerStatement } from "./lowering-stmt";
import { lowerSwitchExpr } from "./lowering-switch";
import {
  getExprKirType,
  lowerCheckerType,
  lowerTypeNode,
  mangleFunctionNameFromType,
} from "./lowering-types";
import {
  emit,
  emitConstInt,
  emitFieldLoad,
  emitStackAlloc,
  freshBlockId,
  freshVar,
  isBlockTerminated,
  isStackAllocVar,
  mapCompoundAssignOp,
  sealCurrentBlock,
  setTerminator,
  startBlock,
} from "./lowering-utils";

// ─── Expressions ─────────────────────────────────────────────────────────

export function lowerExpr(ctx: LoweringCtx, expr: Expression): VarId {
  switch (expr.kind) {
    case "IntLiteral":
      return lowerIntLiteral(ctx, expr);
    case "FloatLiteral":
      return lowerFloatLiteral(ctx, expr);
    case "StringLiteral":
      return lowerStringLiteral(ctx, expr);
    case "BoolLiteral":
      return lowerBoolLiteral(ctx, expr);
    case "NullLiteral":
      return lowerNullLiteral(ctx);
    case "Identifier":
      return lowerIdentifier(ctx, expr);
    case "BinaryExpr":
      return lowerBinaryExpr(ctx, expr);
    case "UnaryExpr":
      return lowerUnaryExpr(ctx, expr);
    case "CallExpr":
      return lowerCallExpr(ctx, expr);
    case "MemberExpr":
      return lowerMemberExpr(ctx, expr);
    case "IndexExpr":
      return lowerIndexExpr(ctx, expr);
    case "DerefExpr":
      return lowerDerefExpr(ctx, expr);
    case "AssignExpr":
      return lowerAssignExpr(ctx, expr);
    case "StructLiteral":
      return lowerStructLiteral(ctx, expr);
    case "IfExpr":
      return lowerIfExpr(ctx, expr);
    case "GroupExpr":
      return lowerExpr(ctx, expr.expression);
    case "UnsafeExpr":
      return lowerUnsafeExpr(ctx, expr);
    case "MoveExpr":
      return lowerMoveExpr(ctx, expr);
    case "ThrowExpr":
      return lowerThrowExpr(ctx, expr);
    case "CatchExpr":
      return lowerCatchExpr(ctx, expr);
    case "CastExpr":
      return lowerCastExpr(ctx, expr);
    case "ArrayLiteral":
      return lowerArrayLiteral(ctx, expr);
    case "SwitchExpr":
      return lowerSwitchExpr(ctx, expr);
    default:
      // Unhandled expression types return a placeholder
      return emitConstInt(ctx, 0);
  }
}

/**
 * Lower an expression but return a pointer (alloc) instead of loading.
 * Used for struct field access where we need the base pointer for field_ptr.
 */
export function lowerExprAsPtr(ctx: LoweringCtx, expr: Expression): VarId {
  if (expr.kind === "Identifier") {
    const varId = ctx.varMap.get(expr.name);
    if (varId) {
      if (isStackAllocVar(ctx, varId)) {
        return varId; // Return the alloc pointer directly
      }
      // For params (like self) that are already pointers to structs, return directly
      return varId;
    }
  }
  // Struct/enum literals already return their backing alloc pointer from
  // lowerExpr — no need to re-wrap.
  if (expr.kind === "StructLiteral") {
    return lowerExpr(ctx, expr);
  }
  // For complex expressions like (a + b).x, lower the expression and wrap in alloc if needed
  const valueId = lowerExpr(ctx, expr);
  const exprType = ctx.checkResult.types.typeMap.get(expr);
  if (exprType?.kind === "struct") {
    const kirType = lowerCheckerType(ctx, exprType);
    const alloc = emitStackAlloc(ctx, kirType);
    emit(ctx, { kind: "store", ptr: alloc, value: valueId });
    return alloc;
  }
  return valueId;
}

export function lowerIdentifier(ctx: LoweringCtx, expr: Identifier): VarId {
  const varId = ctx.varMap.get(expr.name);
  if (!varId) {
    // Could be a function name or unknown — just return a symbolic reference
    return `%${expr.name}`;
  }

  // If the var is a stack_alloc pointer, load it
  // Check if it's a param (params don't need loading)
  if (varId.startsWith("%") && isStackAllocVar(ctx, varId)) {
    const dest = freshVar(ctx);
    const type = getExprKirType(ctx, expr);
    emit(ctx, { kind: "load", dest, ptr: varId, type });
    return dest;
  }

  return varId;
}

/**
 * True iff `callee` is a `Type.method` access where `Type` is an Identifier
 * referring to a struct type in the current scope (rather than a value
 * variable). Used to dispatch static method calls without a self-argument.
 */
function isTypeQualifiedStaticCall(
  ctx: LoweringCtx,
  callee: MemberExpr
): boolean {
  if (callee.object.kind !== "Identifier") return false;
  // The checker records the Identifier's resolved type in typeMap. For a
  // type reference there is no recorded value-type — fall back to a scope
  // lookup against the program's struct/unsafe-struct decls.
  const objType = ctx.checkResult.types.typeMap.get(callee.object);
  if (objType) return false; // it's a value (variable) — instance call
  const name = callee.object.name;
  for (const decl of ctx.program.declarations) {
    if (
      (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") &&
      decl.name === name
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the mangled struct name for a `Type<TypeArgs>.method(args)` call.
 * For non-generic `Type.method(args)` returns the bare struct name.
 */
function resolveStructNameForStaticCall(
  ctx: LoweringCtx,
  expr: CallExpr
): string {
  const callee = expr.callee as MemberExpr;
  const baseName = (callee.object as { name: string }).name;
  if (expr.typeArgs.length === 0) return baseName;
  // Mangle using the type-args' suffix forms — matches how generic struct
  // monomorphization names instances in lowering-types.ts.
  const argSuffixes = expr.typeArgs.map((t) => {
    if (t.kind === "NamedType") return t.name;
    if (t.kind === "RawPtrType" || t.kind === "RefType") return "ptr";
    return "T";
  });
  return `${baseName}_${argSuffixes.join("_")}`;
}

export function lowerCallExpr(ctx: LoweringCtx, expr: CallExpr): VarId {
  // Enum variant construction: Shape.Circle(3.14) → stack_alloc + tag + data fields
  const enumResult = lowerEnumVariantConstruction(ctx, expr);
  if (enumResult !== null) return enumResult;

  // sizeof(Type) → KIR sizeof instruction (resolved by backend)
  if (
    expr.callee.kind === "Identifier" &&
    expr.callee.name === "sizeof" &&
    expr.args.length === 1
  ) {
    const arg = expr.args[0];
    let kirType: KirType;
    if (arg && arg.kind === "Identifier") {
      const namedType: TypeNode = { kind: "NamedType", name: arg.name, span: arg.span };
      kirType = lowerTypeNode(ctx, namedType);
    } else {
      kirType = { kind: "int", bits: 32, signed: true };
    }
    const dest = freshVar(ctx);
    emit(ctx, { kind: "sizeof", dest, type: kirType });
    return dest;
  }

  // Resolve the callee's function type so we can match each arg against
  // its corresponding param. Used for two auto-conversions:
  //   - struct arg → pointer (existing convention).
  //   - T arg → `ref T` param (auto-reference at call site; emits &arg).
  const calleeFnType = (() => {
    const t = ctx.checkResult.types.typeMap.get(expr.callee);
    return t && t.kind === "function" ? (t as FunctionType) : null;
  })();
  const args = expr.args.map((a, i) => {
    const argType = ctx.checkResult.types.typeMap.get(a);
    const paramType = calleeFnType?.params[i]?.type;
    // T → ref T at the call boundary: take the address.
    if (
      paramType?.kind === "ptr" &&
      (paramType as { isRef?: boolean }).isRef &&
      argType?.kind !== "ptr"
    ) {
      return lowerExprAsPtr(ctx, a);
    }
    return argType?.kind === "struct" ? lowerExprAsPtr(ctx, a) : lowerExpr(ctx, a);
  });
  const resultType = getExprKirType(ctx, expr);
  const isVoid = resultType.kind === "void";

  // Get the function name
  let funcName: string;

  // Check for generic call resolution (e.g. max<i32>(a, b) → max_i32)
  const genericName =
    ctx.currentBodyGenericResolutions?.get(expr) ?? ctx.checkResult.generics.resolutions.get(expr);
  if (genericName) {
    funcName = ctx.modulePrefix ? `${ctx.modulePrefix}_${genericName}` : genericName;
  } else if (expr.callee.kind === "Identifier") {
    const baseName = expr.callee.name;
    // Check if this is an imported function that needs module-prefixed name
    const importedName = ctx.importedNames.get(baseName);
    const resolvedBase = importedName ?? baseName;

    // Mangle overloaded function calls using the resolved callee type
    if (ctx.overloadedNames.has(baseName)) {
      const calleeType = ctx.checkResult.types.typeMap.get(expr.callee);
      if (calleeType && calleeType.kind === "function") {
        funcName = mangleFunctionNameFromType(ctx, resolvedBase, calleeType as FunctionType);
      } else {
        funcName = resolvedBase;
      }
    } else {
      funcName = resolvedBase;
    }
  } else if (expr.callee.kind === "MemberExpr") {
    // Check if this is a module-qualified call: module.function(args)
    const objType = ctx.checkResult.types.typeMap.get(expr.callee.object);
    if (objType?.kind === "module") {
      // Module-qualified call: math.add(args) → math_add(args)
      const modulePath = objType.name; // e.g., "math" or "net.http"
      const modulePrefix = modulePath.replace(/\./g, "_");
      const callName = expr.callee.property;
      const baseMangledName = `${modulePrefix}_${callName}`;

      // Check if the function is overloaded
      const calleeResolvedType = ctx.checkResult.types.typeMap.get(expr.callee);
      if (calleeResolvedType && calleeResolvedType.kind === "function") {
        if (ctx.overloadedNames.has(callName)) {
          funcName = mangleFunctionNameFromType(
            ctx,
            baseMangledName,
            calleeResolvedType as FunctionType
          );
        } else {
          funcName = baseMangledName;
        }
      } else {
        funcName = baseMangledName;
      }
    } else if (
      ctx.checkResult.types.staticMethodCalls.has(expr) ||
      isTypeQualifiedStaticCall(ctx, expr.callee)
    ) {
      // Static method call: `Type.method(args)` or `Type<TypeArgs>.method(args)`.
      // No self-arg; resolve the struct type (with type-arg substitution if
      // present) so the mangled name matches the monomorphized struct.
      const recorded = ctx.checkResult.types.staticMethodCalls.get(expr);
      const structName = recorded
        ? recorded.mangledStructName
        : resolveStructNameForStaticCall(ctx, expr);
      funcName = `${structName}_${expr.callee.property}`;
    } else {
      // Instance method call: obj.method(args) → StructName_method(obj, args)
      // Methods expect self as a pointer, so use lowerExprAsPtr for struct objects
      const objId =
        objType?.kind === "struct"
          ? lowerExprAsPtr(ctx, expr.callee.object)
          : lowerExpr(ctx, expr.callee.object);
      const methodName = expr.callee.property;

      if (objType?.kind === "struct") {
        funcName = `${objType.name}_${methodName}`;
      } else {
        funcName = methodName;
      }

      // Struct args were already lowered as pointers above; no re-wrap needed.
      if (isVoid) {
        emit(ctx, { kind: "call_void", func: funcName, args: [objId, ...args] });
        return objId; // void calls return nothing meaningful
      }

      const dest = freshVar(ctx);
      emit(ctx, {
        kind: "call",
        dest,
        func: funcName,
        args: [objId, ...args],
        type: resultType,
      });
      return dest;
    }
  } else {
    funcName = "<unknown>";
  }

  if (isVoid) {
    emit(ctx, { kind: "call_void", func: funcName, args });
    return emitConstInt(ctx, 0); // void calls; return a dummy
  }

  const dest = freshVar(ctx);
  emit(ctx, { kind: "call", dest, func: funcName, args, type: resultType });
  return dest;
}

export function lowerMemberExpr(ctx: LoweringCtx, expr: MemberExpr): VarId {
  // Handle .len on arrays — emit compile-time constant
  if (expr.property === "len") {
    const objectType = ctx.checkResult.types.typeMap.get(expr.object);
    if (objectType?.kind === "array" && objectType.length != null) {
      const dest = freshVar(ctx);
      emit(ctx, {
        kind: "const_int",
        dest,
        type: { kind: "int", bits: 64, signed: false },
        value: objectType.length,
      });
      return dest;
    }
    // For strings, .len is a field access on the kei_string struct
    if (objectType?.kind === "string") {
      const baseId = lowerExpr(ctx, expr.object);
      const resultType = getExprKirType(ctx, expr);
      return emitFieldLoad(ctx, baseId, "len", resultType);
    }
  }

  // Handle enum variant access — emit the variant's integer discriminant
  const objectType = ctx.checkResult.types.typeMap.get(expr.object);
  const enumVariant = lowerEnumVariantAccess(ctx, expr);
  if (enumVariant !== null) return enumVariant;

  // For struct field access, use the alloc pointer directly (not a loaded value).
  // This ensures the alloc is address-taken and won't be incorrectly promoted by mem2reg.
  let baseId: VarId;
  if (expr.object.kind === "Identifier" && objectType?.kind === "struct") {
    const varId = ctx.varMap.get(expr.object.name);
    if (varId && isStackAllocVar(ctx, varId)) {
      baseId = varId; // Use alloc pointer directly
    } else if (varId) {
      baseId = varId; // Param pointer
    } else {
      baseId = lowerExpr(ctx, expr.object);
    }
  } else if (expr.object.kind === "DerefExpr") {
    // (*p).field — the inner operand is already the struct pointer; skip the load.
    baseId = lowerExpr(ctx, expr.object.operand);
  } else if (expr.object.kind === "MemberExpr") {
    // Nested member access: first get the outer field as a pointer
    baseId = lowerExpr(ctx, expr.object);
  } else {
    baseId = lowerExpr(ctx, expr.object);
  }

  const resultType = getExprKirType(ctx, expr);
  return emitFieldLoad(ctx, baseId, expr.property, resultType);
}

/**
 * Lower an array-typed expression to a pointer to its contiguous storage.
 * C cannot pass arrays by value, so for indexing we always want the storage
 * pointer (`T*` decayed from the underlying `T[N]`), never a memcpy'd copy.
 *
 * - `s.data` (array field): emit `field_ptr` (no load).
 * - Anything else: fall back to `lowerExpr`. Stack-alloc identifiers already
 *   yield their alloc pointer; struct/array literals already yield an alloc.
 */
function lowerArrayAsStoragePtr(ctx: LoweringCtx, expr: Expression): VarId {
  if (expr.kind === "MemberExpr") {
    const objectType = ctx.checkResult.types.typeMap.get(expr.object);
    if (objectType?.kind === "struct") {
      const fieldType = getExprKirType(ctx, expr);
      const baseId = lowerExprAsPtr(ctx, expr.object);
      const dest = freshVar(ctx);
      emit(ctx, {
        kind: "field_ptr",
        dest,
        base: baseId,
        field: expr.property,
        type: fieldType,
      });
      return dest;
    }
  }
  return lowerExpr(ctx, expr);
}

export function lowerIndexExpr(ctx: LoweringCtx, expr: IndexExpr): VarId {
  // Check for operator overloading (e.g., obj[i] → obj.op_index(i))
  const opMethod = ctx.checkResult.types.operatorMethods.get(expr);
  if (opMethod) {
    return lowerOperatorMethodCall(ctx, expr.object, opMethod.methodName, opMethod.structType, [
      expr.index,
    ]);
  }

  const objType = ctx.checkResult.types.typeMap.get(expr.object);
  const baseId =
    objType?.kind === "array"
      ? lowerArrayAsStoragePtr(ctx, expr.object)
      : lowerExpr(ctx, expr.object);
  const indexId = lowerExpr(ctx, expr.index);
  const resultType = getExprKirType(ctx, expr);

  // Emit bounds check for arrays with known length
  const objectType = ctx.checkResult.types.typeMap.get(expr.object);
  if (objectType?.kind === "array" && objectType.length != null) {
    const lenId = freshVar(ctx);
    emit(ctx, {
      kind: "const_int",
      dest: lenId,
      type: { kind: "int", bits: 64, signed: false },
      value: objectType.length,
    });
    emit(ctx, { kind: "bounds_check", index: indexId, length: lenId });
  }

  const ptrDest = freshVar(ctx);
  emit(ctx, { kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: resultType });

  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr: ptrDest, type: resultType });
  return dest;
}

export function lowerAssignExpr(ctx: LoweringCtx, expr: AssignExpr): VarId {
  // Check for operator overloading: obj[i] = v → obj.op_index_set(i, v)
  const opMethod = ctx.checkResult.types.operatorMethods.get(expr);
  if (opMethod && expr.target.kind === "IndexExpr") {
    return lowerOperatorMethodCall(
      ctx,
      expr.target.object,
      opMethod.methodName,
      opMethod.structType,
      [expr.target.index, expr.value]
    );
  }

  const valueId = lowerExpr(ctx, expr.value);

  if (expr.target.kind === "Identifier") {
    const ptrId = ctx.varMap.get(expr.target.name);
    if (ptrId) {
      // Handle compound assignment operators
      if (expr.operator !== "=") {
        const op = mapCompoundAssignOp(ctx, expr.operator);
        if (op) {
          const currentVal = freshVar(ctx);
          const type = getExprKirType(ctx, expr.target);
          emit(ctx, { kind: "load", dest: currentVal, ptr: ptrId, type });
          const result = freshVar(ctx);
          emit(ctx, { kind: "bin_op", op, dest: result, lhs: currentVal, rhs: valueId, type });
          emit(ctx, { kind: "store", ptr: ptrId, value: result });
          return result;
        }
      }

      // For simple assignment to managed type: destroy old, store new, oncopy new
      const checkerType = ctx.checkResult.types.typeMap.get(expr.target);
      const lifecycle = getStructLifecycle(ctx, checkerType);
      if (lifecycle?.hasDestroy) {
        // Load old value and destroy it
        const oldVal = freshVar(ctx);
        const type = getExprKirType(ctx, expr.target);
        emit(ctx, { kind: "load", dest: oldVal, ptr: ptrId, type });
        emit(ctx, { kind: "destroy", value: oldVal, structName: lifecycle.structName });
      } else if (checkerType?.kind === "string") {
        // String: call kei_string_destroy on the pointer to the old value
        emit(ctx, { kind: "call_extern_void", func: "kei_string_destroy", args: [ptrId] });
      }

      emit(ctx, { kind: "store", ptr: ptrId, value: valueId });

      // Oncopy the new value (unless it's a move)
      if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
        emit(ctx, { kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    }
  } else if (expr.target.kind === "MemberExpr") {
    // s.field = v — we need a *pointer* to the struct, never a loaded value
    // (C does not allow `&value->field`). Use the alloc pointer for stack vars,
    // the inner ptr for `(*p).field`, and the param pointer for `self.field`.
    const objectType = ctx.checkResult.types.typeMap.get(expr.target.object);
    let baseId: VarId;
    if (expr.target.object.kind === "DerefExpr") {
      baseId = lowerExpr(ctx, expr.target.object.operand);
    } else if (expr.target.object.kind === "Identifier" && objectType?.kind === "struct") {
      baseId = lowerExprAsPtr(ctx, expr.target.object);
    } else {
      baseId = lowerExpr(ctx, expr.target.object);
    }
    const ptrDest = freshVar(ctx);
    const fieldType = getExprKirType(ctx, expr.target);
    emit(ctx, {
      kind: "field_ptr",
      dest: ptrDest,
      base: baseId,
      field: expr.target.property,
      type: fieldType,
    });

    // Compound assignment on a field: `obj.field op= rhs` lowers to
    // load → bin_op → store on the field slot. Field-level lifecycle
    // hooks don't fire here (we're updating the value, not replacing).
    if (expr.operator !== "=") {
      const op = mapCompoundAssignOp(ctx, expr.operator);
      if (op) {
        // For a `ref T` field the slot holds a `*T`, so ptrDest is
        // `**T`. We need to load through one extra layer to get the
        // T-storing slot. The checker's typeMap entry preserves the
        // isRef bit even though the lowered KIR type is `ptr`.
        const checkerType = ctx.checkResult.types.typeMap.get(expr.target);
        const isRefField =
          checkerType?.kind === "ptr" && (checkerType as { isRef?: boolean }).isRef === true;
        let loadPtr = ptrDest;
        let elemType = fieldType;
        if (isRefField && fieldType.kind === "ptr") {
          const innerPtr = freshVar(ctx);
          emit(ctx, { kind: "load", dest: innerPtr, ptr: ptrDest, type: fieldType });
          loadPtr = innerPtr;
          elemType = fieldType.pointee;
        }
        const currentVal = freshVar(ctx);
        emit(ctx, { kind: "load", dest: currentVal, ptr: loadPtr, type: elemType });
        const result = freshVar(ctx);
        emit(ctx, {
          kind: "bin_op",
          op,
          dest: result,
          lhs: currentVal,
          rhs: valueId,
          type: elemType,
        });
        emit(ctx, { kind: "store", ptr: loadPtr, value: result });
        return result;
      }
    }

    // Destroy old field value if it has lifecycle hooks
    const checkerType = ctx.checkResult.types.typeMap.get(expr.target);
    const lifecycle = getStructLifecycle(ctx, checkerType);
    if (lifecycle?.hasDestroy) {
      const oldVal = freshVar(ctx);
      emit(ctx, { kind: "load", dest: oldVal, ptr: ptrDest, type: fieldType });
      emit(ctx, { kind: "destroy", value: oldVal, structName: lifecycle.structName });
    } else if (checkerType?.kind === "string") {
      // String field: call kei_string_destroy on the pointer to the old value
      emit(ctx, { kind: "call_extern_void", func: "kei_string_destroy", args: [ptrDest] });
    }

    emit(ctx, { kind: "store", ptr: ptrDest, value: valueId });

    if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
      emit(ctx, { kind: "oncopy", value: valueId, structName: lifecycle.structName });
    }
  } else if (expr.target.kind === "DerefExpr") {
    // *p = v — store through the raw pointer.
    const ptrId = lowerExpr(ctx, expr.target.operand);
    emit(ctx, { kind: "store", ptr: ptrId, value: valueId });
  } else if (expr.target.kind === "IndexExpr") {
    const objType = ctx.checkResult.types.typeMap.get(expr.target.object);
    const baseId =
      objType?.kind === "array"
        ? lowerArrayAsStoragePtr(ctx, expr.target.object)
        : lowerExpr(ctx, expr.target.object);
    const indexId = lowerExpr(ctx, expr.target.index);
    const elemType = getExprKirType(ctx, expr.target);
    const ptrDest = freshVar(ctx);
    emit(ctx, { kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: elemType });

    // Destroy old element value if it's a managed type
    const checkerType = ctx.checkResult.types.typeMap.get(expr.target);
    const lifecycle = getStructLifecycle(ctx, checkerType);
    if (lifecycle?.hasDestroy) {
      const oldVal = freshVar(ctx);
      emit(ctx, { kind: "load", dest: oldVal, ptr: ptrDest, type: elemType });
      emit(ctx, { kind: "destroy", value: oldVal, structName: lifecycle.structName });
    } else if (checkerType?.kind === "string") {
      emit(ctx, { kind: "call_extern_void", func: "kei_string_destroy", args: [ptrDest] });
    }

    emit(ctx, { kind: "store", ptr: ptrDest, value: valueId });
  }

  return valueId;
}

export function lowerIfExpr(ctx: LoweringCtx, expr: IfExpr): VarId {
  const condId = lowerExpr(ctx, expr.condition);
  const resultType = getExprKirType(ctx, expr);

  const thenLabel = freshBlockId(ctx, "ifexpr.then");
  const elseLabel = freshBlockId(ctx, "ifexpr.else");
  const endLabel = freshBlockId(ctx, "ifexpr.end");

  // Allocate result on stack
  const resultPtr = emitStackAlloc(ctx, resultType);

  setTerminator(ctx, { kind: "br", cond: condId, thenBlock: thenLabel, elseBlock: elseLabel });

  // Then
  sealCurrentBlock(ctx);
  startBlock(ctx, thenLabel);
  const thenStmts = expr.thenBlock.statements;
  for (const s of thenStmts) {
    if (s.kind === "ExprStmt") {
      const val = lowerExpr(ctx, s.expression);
      emit(ctx, { kind: "store", ptr: resultPtr, value: val });
    } else {
      lowerStatement(ctx, s);
    }
  }
  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: endLabel });
  }

  // Else
  sealCurrentBlock(ctx);
  startBlock(ctx, elseLabel);
  const elseStmts = expr.elseBlock.statements;
  for (const s of elseStmts) {
    if (s.kind === "ExprStmt") {
      const val = lowerExpr(ctx, s.expression);
      emit(ctx, { kind: "store", ptr: resultPtr, value: val });
    } else {
      lowerStatement(ctx, s);
    }
  }
  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: endLabel });
  }

  // End
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);

  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

export function lowerDerefExpr(ctx: LoweringCtx, expr: DerefExpr): VarId {
  const ptr = lowerExpr(ctx, expr.operand);
  const type = getExprKirType(ctx, expr);
  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr, type });
  return dest;
}

export function lowerUnsafeExpr(ctx: LoweringCtx, expr: UnsafeExpr): VarId {
  pushScope(ctx);
  const outerVarMap = ctx.varMap;
  ctx.varMap = new Map(outerVarMap);

  let result: VarId | null = null;

  for (const stmt of expr.body.statements) {
    if (isBlockTerminated(ctx)) break;

    if (stmt.kind === "ExprStmt") {
      result = lowerExpr(ctx, stmt.expression);
    } else {
      lowerStatement(ctx, stmt);
      result = null;
    }
  }

  if (isBlockTerminated(ctx)) {
    ctx.scopeStack.pop();
    ctx.deferStack.pop();
  } else {
    popScopeWithDestroy(ctx);
  }

  ctx.varMap = outerVarMap;
  return result ?? emitConstInt(ctx, 0);
}

export function lowerMoveExpr(ctx: LoweringCtx, expr: MoveExpr): VarId {
  const sourceId = lowerExpr(ctx, expr.operand);
  const dest = freshVar(ctx);
  const type = getExprKirType(ctx, expr.operand);
  emit(ctx, { kind: "move", dest, source: sourceId, type });

  // Mark the source variable as moved so it won't be destroyed at scope exit
  if (expr.operand.kind === "Identifier") {
    ctx.movedVars.add(expr.operand.name);
  }

  return dest;
}

export function lowerCastExpr(ctx: LoweringCtx, expr: CastExpr): VarId {
  const value = lowerExpr(ctx, expr.operand);
  const targetType = getExprKirType(ctx, expr);
  const dest = freshVar(ctx);
  emit(ctx, { kind: "cast", dest, value, targetType });
  return dest;
}

// lowerSwitchExpr and findConstIntInst are in lowering-switch.ts
// lowerEnumVariantConstruction and lowerEnumVariantAccess are in lowering-enum.ts
