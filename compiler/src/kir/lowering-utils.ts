/**
 * Basic emit helpers and small utilities used across all lowering passes.
 *
 * Pure functions over `LoweringCtx`. No `this`. Same-file calls take `ctx`
 * explicitly (e.g. `freshVar(ctx)`). Cross-file calls would import from
 * `./lowering-*.ts` siblings; this file happens to be self-contained.
 */

import type { BinOp, BlockId, KirInst, KirTerminator, KirType, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";

export function freshVar(ctx: LoweringCtx): VarId {
  return `%${ctx.varCounter++}`;
}

export function freshBlockId(ctx: LoweringCtx, prefix: string): BlockId {
  return `${prefix}.${ctx.blockCounter++}`;
}

export function emit(ctx: LoweringCtx, inst: KirInst): void {
  ctx.currentInsts.push(inst);
}

export function emitConstInt(ctx: LoweringCtx, value: number): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
  return dest;
}

export function setTerminator(ctx: LoweringCtx, term: KirTerminator): void {
  if (!isBlockTerminated(ctx)) {
    ctx.pendingTerminator = term;
  }
}

export function isBlockTerminated(ctx: LoweringCtx): boolean {
  return ctx.pendingTerminator != null;
}

export function sealCurrentBlock(ctx: LoweringCtx): void {
  const terminator: KirTerminator = ctx.pendingTerminator ?? { kind: "unreachable" };
  ctx.blocks.push({
    id: ctx.currentBlockId,
    phis: [],
    instructions: ctx.currentInsts,
    terminator,
  });
  ctx.currentInsts = [];
  ctx.pendingTerminator = null;
}

export function startBlock(ctx: LoweringCtx, id: BlockId): void {
  ctx.currentBlockId = id;
  ctx.currentInsts = [];
  ctx.pendingTerminator = null;
}

export function ensureTerminator(ctx: LoweringCtx, returnType: KirType): void {
  if (!isBlockTerminated(ctx)) {
    if (returnType.kind === "void") {
      setTerminator(ctx, { kind: "ret_void" });
    } else {
      // Should not happen in well-typed code, but add unreachable as safety.
      setTerminator(ctx, { kind: "unreachable" });
    }
  }
}

export function isStackAllocVar(ctx: LoweringCtx, varId: VarId): boolean {
  for (const block of ctx.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
    }
  }
  for (const inst of ctx.currentInsts) {
    if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
  }
  return false;
}

const BIN_OP_MAP: Record<string, BinOp> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "mod",
  "==": "eq",
  "!=": "neq",
  "<": "lt",
  ">": "gt",
  "<=": "lte",
  ">=": "gte",
  "&": "bit_and",
  "|": "bit_or",
  "^": "bit_xor",
  "<<": "shl",
  ">>": "shr",
  "&&": "and",
  "||": "or",
};

const COMPOUND_ASSIGN_OP_MAP: Record<string, BinOp> = {
  "+=": "add",
  "-=": "sub",
  "*=": "mul",
  "/=": "div",
  "%=": "mod",
  "&=": "bit_and",
  "|=": "bit_or",
  "^=": "bit_xor",
  "<<=": "shl",
  ">>=": "shr",
};

export function mapBinOp(_ctx: LoweringCtx, op: string): BinOp | null {
  return BIN_OP_MAP[op] ?? null;
}

export function mapCompoundAssignOp(_ctx: LoweringCtx, op: string): BinOp | null {
  return COMPOUND_ASSIGN_OP_MAP[op] ?? null;
}

/** Emit a stack_alloc and return the pointer VarId. */
export function emitStackAlloc(ctx: LoweringCtx, type: KirType): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "stack_alloc", dest, type });
  return dest;
}

/** Emit field_ptr + load and return the loaded value VarId. */
export function emitFieldLoad(ctx: LoweringCtx, base: VarId, field: string, type: KirType): VarId {
  const ptr = freshVar(ctx);
  emit(ctx, { kind: "field_ptr", dest: ptr, base, field, type });
  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr, type });
  return dest;
}

/** Compare tag == 0 (success check for error handling). Returns the bool VarId. */
export function emitTagIsSuccess(ctx: LoweringCtx, tagVar: VarId): VarId {
  const zeroConst = emitConstInt(ctx, 0);
  const isOk = freshVar(ctx);
  emit(ctx, {
    kind: "bin_op",
    op: "eq",
    dest: isOk,
    lhs: tagVar,
    rhs: zeroConst,
    type: { kind: "bool" },
  });
  return isOk;
}

/** Cast a void* pointer to a typed pointer. Returns the cast VarId. */
export function emitCastToPtr(ctx: LoweringCtx, value: VarId, pointeeType: KirType): VarId {
  const dest = freshVar(ctx);
  emit(ctx, { kind: "cast", dest, value, targetType: { kind: "ptr", pointee: pointeeType } });
  return dest;
}

/** Load current value from ptr, apply binary op with rhs, store result back. Returns the new value. */
export function emitLoadModifyStore(
  ctx: LoweringCtx,
  ptr: VarId,
  op: BinOp,
  rhs: VarId,
  type: KirType
): VarId {
  const currentVal = freshVar(ctx);
  emit(ctx, { kind: "load", dest: currentVal, ptr, type });
  const result = freshVar(ctx);
  emit(ctx, { kind: "bin_op", op, dest: result, lhs: currentVal, rhs, type });
  emit(ctx, { kind: "store", ptr, value: result });
  return currentVal;
}
