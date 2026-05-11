/**
 * Lifecycle module — Insert sub-concern (rewrite pass).
 *
 * Slots between KIR lowering and mem2reg. Walks every function, every
 * block, and rewrites the six marker instructions (`mark_scope_enter`,
 * `mark_scope_exit`, `mark_track`, `mark_moved`, `mark_assign`,
 * `mark_param`) into concrete `destroy` / `oncopy` instructions using the
 * Lifecycle decision map.
 *
 * PR 3 lands the slot only: the pass is a **no-op rewriter**. It strips
 * any markers it encounters and emits nothing new. No lowering site emits
 * markers yet — that cut-over happens one site at a time across PRs
 * 4a–4e (`docs/design/lifecycle-module.md` §7). The decision map
 * parameter is plumbed through but unused; landing it on the signature
 * now means PR 4a doesn't have to widen the call.
 *
 * After the pass, no `mark_*` instruction survives — mem2reg, de-SSA,
 * and the C emitter never see markers.
 *
 * See `docs/design/lifecycle-module.md` §2 (pipeline diagram) and §3
 * (marker IR table).
 */

import type { StructType } from "../checker/types";
import type { KirBlock, KirFunction, KirInst, KirModule } from "../kir/kir-types";
import type { LifecycleDecision } from "./types";

/**
 * Look up the Lifecycle decision for a struct, or `undefined` when no
 * auto-generation applies. Same shape as `CheckLifecycle.getDecision` on
 * the checker's result — the driver threads that lookup through here.
 */
export type LifecycleDecisionLookup = (struct: StructType) => LifecycleDecision | undefined;

/**
 * Run the Lifecycle rewrite pass over `module`. Marker instructions are
 * stripped; every other instruction passes through in its original order.
 *
 * Returns a new module — input is not mutated.
 */
export function runLifecyclePass(
  module: KirModule,
  _decisions: LifecycleDecisionLookup
): KirModule {
  return {
    ...module,
    functions: module.functions.map(rewriteFunction),
  };
}

function rewriteFunction(fn: KirFunction): KirFunction {
  return {
    ...fn,
    blocks: fn.blocks.map(rewriteBlock),
  };
}

function rewriteBlock(block: KirBlock): KirBlock {
  return {
    ...block,
    instructions: block.instructions.filter(isNotMarker),
  };
}

function isNotMarker(inst: KirInst): boolean {
  switch (inst.kind) {
    case "mark_scope_enter":
    case "mark_scope_exit":
    case "mark_track":
    case "mark_moved":
    case "mark_assign":
    case "mark_param":
      return false;
    default:
      return true;
  }
}
