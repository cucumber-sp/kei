import type { BlockId, ScopeId, VarId } from "./identifiers";
import type { KirInst } from "./instructions";
import type { KirTerminator } from "./terminators";
import type { KirType } from "./types";

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Snapshot accompanying a `mark_scope_exit` marker: the set of source-level
 * var names to skip when emitting destroys (the named local being returned,
 * where the var must survive past the destroy sequence).
 *
 * After PR 4d + 4e, both the live-vars set and the moved-set are
 * reconstructed by the Lifecycle pass from the `mark_track` and
 * `mark_moved` marker streams. This side-channel survives only to carry
 * the returned-name skip that lowering still owns; once that is migrated
 * the field disappears entirely.
 */
export interface KirScopeExitInfo {
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
