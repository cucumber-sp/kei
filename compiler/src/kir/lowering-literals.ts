/**
 * Literal and composite expression lowering — operates on LoweringCtx.
 * Extracted from lowering-expr.ts for modularity.
 */

import type {
  ArrayLiteral,
  BoolLiteral,
  FloatLiteral,
  IntLiteral,
  StringLiteral,
  StructLiteral,
} from "../ast/nodes.ts";
import type { KirFloatType, KirIntType, KirType, VarId } from "./kir-types.ts";
import type { LoweringCtx } from "./lowering-ctx.ts";
import { lowerExpr } from "./lowering-expr.ts";
import { lowerCheckerType, getExprKirType } from "./lowering-types.ts";
import { emit, emitStackAlloc, freshVar } from "./lowering-utils.ts";

export function lowerIntLiteral(ctx: LoweringCtx, expr: IntLiteral): VarId {
  const dest = freshVar(ctx);
  const checkerType = ctx.checkResult.typeMap.get(expr);
  let type: KirIntType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "int") {
    type = { kind: "int", bits: checkerType.bits, signed: checkerType.signed };
  }
  emit(ctx, { kind: "const_int", dest, type, value: expr.value });
  return dest;
}

export function lowerFloatLiteral(ctx: LoweringCtx, expr: FloatLiteral): VarId {
  const dest = freshVar(ctx);
  const checkerType = ctx.checkResult.typeMap.get(expr);
  let type: KirFloatType = { kind: "float", bits: 64 };
  if (checkerType?.kind === "float") {
    type = { kind: "float", bits: checkerType.bits };
  }
  emit(ctx, { kind: "const_float", dest, type, value: expr.value });
  return dest;
}

export function lowerStringLiteral(ctx: LoweringCtx, expr: StringLiteral): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "const_string", dest, value: expr.value });
  return dest;
}

export function lowerBoolLiteral(ctx: LoweringCtx, expr: BoolLiteral): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "const_bool", dest, value: expr.value });
  return dest;
}

export function lowerNullLiteral(ctx: LoweringCtx): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "const_null", dest, type: { kind: "ptr", pointee: { kind: "void" } } });
  return dest;
}

export function lowerStructLiteral(ctx: LoweringCtx, expr: StructLiteral): VarId {
  const type = getExprKirType(ctx, expr);
  const ptrId = emitStackAlloc(ctx, type);

  for (const field of expr.fields) {
    const valueId = lowerExpr(ctx, field.value);
    const fieldPtrId = freshVar(ctx);
    const fieldType = getExprKirType(ctx, field.value);
    emit(ctx, {
      kind: "field_ptr",
      dest: fieldPtrId,
      base: ptrId,
      field: field.name,
      type: fieldType,
    });
    emit(ctx, { kind: "store", ptr: fieldPtrId, value: valueId });
  }

  return ptrId;
}

export function lowerArrayLiteral(ctx: LoweringCtx, expr: ArrayLiteral): VarId {
  const checkerType = ctx.checkResult.typeMap.get(expr);
  let elemType: KirType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "array") {
    elemType = lowerCheckerType(ctx, checkerType.element);
  }

  const arrType: KirType = { kind: "array", element: elemType, length: expr.elements.length };
  const ptrId = emitStackAlloc(ctx, arrType);

  // Store each element at its index
  for (let i = 0; i < expr.elements.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index i is bounded by expr.elements.length
    const valueId = lowerExpr(ctx, expr.elements[i]!);
    const idxId = freshVar(ctx);
    emit(ctx, {
      kind: "const_int",
      dest: idxId,
      type: { kind: "int", bits: 64, signed: false },
      value: i,
    });
    const elemPtrId = freshVar(ctx);
    emit(ctx, { kind: "index_ptr", dest: elemPtrId, base: ptrId, index: idxId, type: elemType });
    emit(ctx, { kind: "store", ptr: elemPtrId, value: valueId });
  }

  return ptrId;
}
