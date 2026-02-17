/**
 * Basic emit helpers and utility methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type {
  KirInst,
  KirTerminator,
  KirType,
  VarId,
  BlockId,
  BinOp,
} from "./kir-types.ts";
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
    (this as any)._pendingTerminator = term;
  }
}

export function isBlockTerminated(this: KirLowerer): boolean {
  return (this as any)._pendingTerminator != null;
}

export function sealCurrentBlock(this: KirLowerer): void {
  const terminator: KirTerminator = (this as any)._pendingTerminator ?? { kind: "unreachable" };
  this.blocks.push({
    id: this.currentBlockId,
    phis: [],
    instructions: this.currentInsts,
    terminator,
  });
  this.currentInsts = [];
  (this as any)._pendingTerminator = null;
}

export function startBlock(this: KirLowerer, id: BlockId): void {
  this.currentBlockId = id;
  this.currentInsts = [];
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
    "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
    "==": "eq", "!=": "neq", "<": "lt", ">": "gt", "<=": "lte", ">=": "gte",
    "&": "bit_and", "|": "bit_or", "^": "bit_xor", "<<": "shl", ">>": "shr",
    "&&": "and", "||": "or",
  };
  return map[op] ?? null;
}

export function mapCompoundAssignOp(this: KirLowerer, op: string): BinOp | null {
  const map: Record<string, BinOp> = {
    "+=": "add", "-=": "sub", "*=": "mul", "/=": "div", "%=": "mod",
    "&=": "bit_and", "|=": "bit_or", "^=": "bit_xor", "<<=": "shl", ">>=": "shr",
  };
  return map[op] ?? null;
}
