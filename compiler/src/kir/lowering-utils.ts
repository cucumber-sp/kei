/**
 * Basic emit helpers and utility methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type { BinOp, BlockId, KirInst, KirTerminator, KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function freshVar(this: KirLowerer): VarId {
  return `%${this.varCounter++}`;
}

export function freshBlockId(this: KirLowerer, prefix: string): BlockId {
  return `${prefix}.${this.blockCounter++}`;
}

export function emit(this: KirLowerer, inst: KirInst): void {
  this.currentInsts.push(inst);
}

export function emitConstInt(this: KirLowerer, value: number): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
  return dest;
}

export function setTerminator(this: KirLowerer, term: KirTerminator): void {
  // Only set terminator if block hasn't been terminated yet
  if (!this.isBlockTerminated()) {
    // biome-ignore lint/suspicious/noExplicitAny: _pendingTerminator is a private field not declared on KirLowerer's interface
    (this as any)._pendingTerminator = term;
  }
}

export function isBlockTerminated(this: KirLowerer): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: _pendingTerminator is a private field not declared on KirLowerer's interface
  return (this as any)._pendingTerminator != null;
}

export function sealCurrentBlock(this: KirLowerer): void {
  // biome-ignore lint/suspicious/noExplicitAny: _pendingTerminator is a private field not declared on KirLowerer's interface
  const terminator: KirTerminator = (this as any)._pendingTerminator ?? { kind: "unreachable" };
  this.blocks.push({
    id: this.currentBlockId,
    phis: [],
    instructions: this.currentInsts,
    terminator,
  });
  this.currentInsts = [];
  // biome-ignore lint/suspicious/noExplicitAny: _pendingTerminator is a private field not declared on KirLowerer's interface
  (this as any)._pendingTerminator = null;
}

export function startBlock(this: KirLowerer, id: BlockId): void {
  this.currentBlockId = id;
  this.currentInsts = [];
  // biome-ignore lint/suspicious/noExplicitAny: _pendingTerminator is a private field not declared on KirLowerer's interface
  (this as any)._pendingTerminator = null;
}

export function ensureTerminator(this: KirLowerer, returnType: KirType): void {
  if (!this.isBlockTerminated()) {
    if (returnType.kind === "void") {
      this.setTerminator({ kind: "ret_void" });
    } else {
      // Should not happen in well-typed code, but add unreachable as safety
      this.setTerminator({ kind: "unreachable" });
    }
  }
}

export function isStackAllocVar(this: KirLowerer, varId: VarId): boolean {
  // Check if any instruction in current block or previous blocks allocated this var
  for (const block of this.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
    }
  }
  for (const inst of this.currentInsts) {
    if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
  }
  return false;
}

export function mapBinOp(this: KirLowerer, op: string): BinOp | null {
  const map: Record<string, BinOp> = {
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
  return map[op] ?? null;
}

export function mapCompoundAssignOp(this: KirLowerer, op: string): BinOp | null {
  const map: Record<string, BinOp> = {
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
  return map[op] ?? null;
}

/** Emit a stack_alloc and return the pointer VarId. */
export function emitStackAlloc(this: KirLowerer, type: KirType): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "stack_alloc", dest, type });
  return dest;
}

/** Emit field_ptr + load and return the loaded value VarId. */
export function emitFieldLoad(this: KirLowerer, base: VarId, field: string, type: KirType): VarId {
  const ptr = this.freshVar();
  this.emit({ kind: "field_ptr", dest: ptr, base, field, type });
  const dest = this.freshVar();
  this.emit({ kind: "load", dest, ptr, type });
  return dest;
}

/** Compare tag == 0 (success check for error handling). Returns the bool VarId. */
export function emitTagIsSuccess(this: KirLowerer, tagVar: VarId): VarId {
  const zeroConst = this.emitConstInt(0);
  const isOk = this.freshVar();
  this.emit({
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
export function emitCastToPtr(this: KirLowerer, value: VarId, pointeeType: KirType): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "cast", dest, value, targetType: { kind: "ptr", pointee: pointeeType } });
  return dest;
}

/** Load current value from ptr, apply binary op with rhs, store result back. Returns the new value. */
export function emitLoadModifyStore(
  this: KirLowerer,
  ptr: VarId,
  op: BinOp,
  rhs: VarId,
  type: KirType
): VarId {
  const currentVal = this.freshVar();
  this.emit({ kind: "load", dest: currentVal, ptr, type });
  const result = this.freshVar();
  this.emit({ kind: "bin_op", op, dest: result, lhs: currentVal, rhs, type });
  this.emit({ kind: "store", ptr, value: result });
  return currentVal;
}
