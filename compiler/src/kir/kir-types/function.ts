import type { BlockId, ScopeId, VarId } from "./identifiers";
import type { KirInst } from "./instructions";
import type { KirTerminator } from "./terminators";
import type { KirType } from "./types";

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Snapshot accompanying a `mark_scope_exit` marker: the live vars in
 * declaration order, plus the set of var names to skip when emitting
 * destroys (the named local being returned, where the var must survive
 * past the destroy sequence).
 *
 * Transitional side-channel for Lifecycle PR 4a — lowering still owns
 * the scope stack, so it captures the relevant slice here at
 * marker-emission time and the pass reads it back. Sibling PR 4e
 * migrates `mark_track` into the IR proper, after which the pass
 * reconstructs the same info from the marker stream and this field is
 * removed.
 */
export interface KirScopeExitInfo {
  vars: ReadonlyArray<{
    name: string;
    varId: VarId;
    structName: string;
    isString?: boolean;
  }>;
  skipNames: ReadonlySet<string>;
}

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
  /**
   * Transitional Lifecycle PR 4a side-table: scope-exit snapshots keyed
   * by the `scopeId` baked into each `mark_scope_exit` instruction. Set
   * by lowering, consumed and stripped by the Lifecycle pass.
   * `undefined` after the pass and on functions that lowering produced
   * without any scope-exit markers.
   */
  lifecycleScopeExits?: ReadonlyMap<ScopeId, KirScopeExitInfo>;
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
