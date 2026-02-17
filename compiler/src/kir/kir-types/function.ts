import type { BlockId, VarId } from "./identifiers";
import type { KirInst } from "./instructions";
import type { KirTerminator } from "./terminators";
import type { KirType } from "./types";

// ─── Function ────────────────────────────────────────────────────────────────

/** A KIR function — a list of basic blocks in SSA form. */
export interface KirFunction {
  name: string;
  params: KirParam[];
  returnType: KirType;
  blocks: KirBlock[];
  localCount: number;
  /**
   * If non-empty, this function uses the throws protocol:
   * actual return type is i32 (tag), with `__out` and `__err` out-pointers
   * appended to params.
   */
  throwsTypes?: KirType[];
}

/** Named function parameter. */
export interface KirParam {
  name: string;
  type: KirType;
}

// ─── Basic Block ─────────────────────────────────────────────────────────────

/**
 * A basic block — a straight-line sequence of instructions ending with
 * exactly one terminator. May have phi nodes at the top for SSA merges.
 */
export interface KirBlock {
  id: BlockId;
  phis: KirPhi[];
  instructions: KirInst[];
  terminator: KirTerminator;
}

// ─── Phi Node ────────────────────────────────────────────────────────────────

/** SSA phi node — selects a value based on which predecessor block executed. */
export interface KirPhi {
  dest: VarId;
  type: KirType;
  incoming: { value: VarId; from: BlockId }[];
}
