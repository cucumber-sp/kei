/**
 * Lifecycle module — Insert sub-concern (rewrite pass).
 *
 * Slots between KIR lowering and mem2reg. Walks every function, every
 * block, and rewrites the six marker instructions (`mark_scope_enter`,
 * `mark_scope_exit`, `mark_track`, `mark_moved`, `mark_assign`,
 * `mark_param`) into concrete `destroy` / `oncopy` instructions using the
 * Lifecycle decision map.
 *
 * Migration status (`docs/design/lifecycle-module.md` §7):
 *
 * - PR 3 — pass slot, no-op rewrite. All markers are stripped, no real
 *   destroy / oncopy emitted in their place.
 * - PR 4c — `mark_param` rewrites into per-exit destroys. The remaining
 *   four markers (`mark_scope_enter`/`exit`, `mark_track`, `mark_moved`,
 *   `mark_assign`) are still stripped without effect; their cut-over
 *   lands in sibling PRs 4a/4b/4d/4e.
 *
 * After the pass, no `mark_*` instruction survives — mem2reg, de-SSA,
 * and the C emitter never see markers.
 *
 * See `docs/design/lifecycle-module.md` §2 (pipeline diagram) and §3
 * (marker IR table).
 */

import type { StructType } from "../checker/types";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirModule,
  KirTerminator,
  VarId,
} from "../kir/kir-types";
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
  // Pre-pass: collect `mark_param` markers across all blocks. Params live
  // for the entire function and must be destroyed at every exit point —
  // collection-then-emit lets the rewrite walk avoid order dependencies
  // between marker placement and the terminators that consume them.
  const paramDestroys = collectParamDestroys(fn);

  return {
    ...fn,
    blocks: fn.blocks.map((block) => rewriteBlock(block, paramDestroys)),
  };
}

/**
 * Walk every block, find each `mark_param`, and resolve its struct name
 * from the function's `params` list. Returns the destroy instructions
 * that must fire before every exit terminator, in marker-emission order
 * (params don't carry the reverse-declaration-order spec invariant —
 * that's locals only, per spec §6.9).
 *
 * Managed-struct params lower to `ptr → struct`: KIR wraps a struct-typed
 * param in a pointer so `field_ptr` always operates on a base pointer.
 * The struct name lives on the pointee.
 */
function collectParamDestroys(fn: KirFunction): KirInst[] {
  const structNameByVarId = new Map<VarId, string>();
  for (const p of fn.params) {
    if (p.type.kind !== "ptr") continue;
    if (p.type.pointee.kind !== "struct") continue;
    structNameByVarId.set(`%${p.name}`, p.type.pointee.name);
  }

  const destroys: KirInst[] = [];
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind !== "mark_param") continue;
      const structName = structNameByVarId.get(inst.param);
      if (!structName) continue;
      destroys.push({ kind: "destroy", value: inst.param, structName });
    }
  }
  return destroys;
}

function rewriteBlock(block: KirBlock, paramDestroys: KirInst[]): KirBlock {
  const filtered = block.instructions.filter(isNotMarker);
  const instructions = isExitTerminator(block.terminator)
    ? [...filtered, ...paramDestroys]
    : filtered;
  return {
    ...block,
    instructions,
  };
}

/** Function exits (`ret` / `ret_void`) trigger param destroys; other terminators don't. */
function isExitTerminator(t: KirTerminator): boolean {
  return t.kind === "ret" || t.kind === "ret_void";
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
