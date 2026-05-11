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
 * - PR 3 — pass slot, no-op rewrite. All markers stripped, nothing
 *   concrete emitted in their place.
 * - PR 4a — `mark_scope_exit` rewrites into per-scope destroys in
 *   reverse declaration order, skipping moved-out vars. String slots
 *   lower to `call_extern_void("kei_string_destroy")`; struct slots
 *   lower to `destroy`. The marker carries only a `scopeId`; vars and
 *   the moved-set come from a transitional `KirFunction.lifecycleScopeExits`
 *   side-table populated by lowering. Sibling PRs 4d / 4e migrate
 *   `mark_moved` / `mark_track` into the IR proper, after which the
 *   pass reconstructs the same info from the marker stream and the
 *   side-table is removed.
 * - PR 4b — `mark_assign` rewrites into load/destroy/store/oncopy
 *   (the slot's pointee KIR type drives the dispatch).
 * - PR 4c — `mark_param` rewrites into per-exit destroys.
 *
 * Other markers (`mark_scope_enter`, `mark_track`, `mark_moved`) remain
 * stripped without effect; their cut-overs land in sibling PRs 4d / 4e.
 *
 * After the pass, no `mark_*` instruction survives and no
 * `lifecycleScopeExits` side-table survives — mem2reg, de-SSA, and the
 * C emitter never see either.
 *
 * See `docs/design/lifecycle-module.md` §2 (pipeline diagram), §3
 * (marker IR table), and §5 (defer-vs-destroy interleave).
 */

import type { StructType } from "../checker/types";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirMarkAssign,
  KirModule,
  KirScopeExitInfo,
  KirTerminator,
  KirType,
  VarId,
} from "../kir/kir-types";
import type { LifecycleDecision } from "./types";

/**
 * Look up the Lifecycle decision for a struct, or `undefined` when no
 * auto-generation applies. Same shape as `CheckLifecycle.getDecision` on
 * the checker's result — the driver threads that lookup through here.
 */
export type LifecycleDecisionLookup = (struct: StructType) => LifecycleDecision | undefined;

/** Mangled struct names that have an auto-or-user `__destroy` / `__oncopy`. */
interface StructHookSets {
  destroys: Set<string>;
  oncopies: Set<string>;
}

/**
 * Run the Lifecycle pass over a KIR module. Returns a new module with
 * markers rewritten (or stripped for not-yet-cut-over markers). The
 * decisions parameter is plumbed through for future use; today's
 * implementation reads the hook presence from the module's function
 * names (`<mangled>___destroy` / `___oncopy`) rather than from the
 * decision map, because both auto-generated and user-written hooks
 * share the same mangling.
 *
 * `mark_scope_exit` is rewritten into reverse-order destroys for the
 * scope's tracked vars (read from the function's transitional
 * `lifecycleScopeExits` side-table, skipping any var named in the
 * matching `skipNames` set).
 *
 * Returns a new module — input is not mutated.
 */
export function runLifecyclePass(
  module: KirModule,
  _decisions: LifecycleDecisionLookup
): KirModule {
  const hooks = collectStructHooks(module);
  return {
    ...module,
    functions: module.functions.map((fn) => rewriteFunction(fn, hooks)),
  };
}

/**
 * Scan `module.functions` for `<struct>___destroy` / `<struct>___oncopy`
 * entries. These are emitted in two ways — by `Lifecycle.synthesise` for
 * auto-generated arms and by `lowering-decl.ts` when the user wrote the
 * method explicitly. Both paths share the same mangling, so a single
 * name-based scan covers both.
 */
function collectStructHooks(module: KirModule): StructHookSets {
  const destroys = new Set<string>();
  const oncopies = new Set<string>();
  for (const fn of module.functions) {
    if (fn.name.endsWith("___destroy")) {
      destroys.add(fn.name.slice(0, -"___destroy".length));
    } else if (fn.name.endsWith("___oncopy")) {
      oncopies.add(fn.name.slice(0, -"___oncopy".length));
    }
  }
  return { destroys, oncopies };
}

function rewriteFunction(fn: KirFunction, hooks: StructHookSets): KirFunction {
  // Pre-pass: collect `mark_param` markers across all blocks. Params live
  // for the entire function and must be destroyed at every exit point.
  const paramDestroys = collectParamDestroys(fn);

  // Pre-pass: pointee KIR types for pointer-producing instructions.
  // `mark_assign slot, _, _` recovers the slot's pointee at rewrite time
  // from this map (markers don't carry types — see design doc §3).
  const pointees = collectPointeeTypes(fn);

  // The mark_assign rewrite may inject `load` instructions. Those need
  // fresh VarIds; start numbering at `fn.localCount` so they don't
  // collide with names lowering already used.
  const counter = { next: fn.localCount };

  const scopeExits = fn.lifecycleScopeExits;

  const blocks = fn.blocks.map((block) =>
    rewriteBlock(block, hooks, pointees, counter, paramDestroys, scopeExits)
  );
  // The side-table is consumed here; downstream passes (mem2reg, de-SSA,
  // C emitter) never see it.
  const { lifecycleScopeExits: _, ...rest } = fn;
  return { ...rest, blocks, localCount: counter.next };
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

/**
 * Walk every instruction in `fn` and collect the pointee KIR type for
 * each pointer-producing instruction (`stack_alloc`, `field_ptr`,
 * `index_ptr`). The pass uses this to recover the slot's pointee type
 * when rewriting a `mark_assign` marker.
 */
function collectPointeeTypes(fn: KirFunction): Map<VarId, KirType> {
  const pointees = new Map<VarId, KirType>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      switch (inst.kind) {
        case "stack_alloc":
        case "field_ptr":
        case "index_ptr":
          pointees.set(inst.dest, inst.type);
          break;
      }
    }
  }
  return pointees;
}

function rewriteBlock(
  block: KirBlock,
  hooks: StructHookSets,
  pointees: Map<VarId, KirType>,
  counter: { next: number },
  paramDestroys: KirInst[],
  scopeExits: ReadonlyMap<number, KirScopeExitInfo> | undefined
): KirBlock {
  const out: KirInst[] = [];
  for (const inst of block.instructions) {
    if (inst.kind === "mark_assign") {
      rewriteMarkAssign(out, inst, hooks, pointees, counter);
      continue;
    }
    if (inst.kind === "mark_scope_exit") {
      const info = scopeExits?.get(inst.scopeId);
      if (info) emitScopeExitDestroys(out, info);
      continue;
    }
    if (isOtherMarker(inst)) continue;
    out.push(inst);
  }
  // Append per-exit param destroys if this block ends with a function
  // exit terminator (ret / ret_void).
  const instructions = isExitTerminator(block.terminator) ? [...out, ...paramDestroys] : out;
  return { ...block, instructions };
}

/** Function exits (`ret` / `ret_void`) trigger param destroys; other terminators don't. */
function isExitTerminator(t: KirTerminator): boolean {
  return t.kind === "ret" || t.kind === "ret_void";
}

/**
 * Emit destroys for `info.vars` in reverse declaration order, skipping
 * any var whose name appears in `info.skipNames` (moved-out vars and,
 * for the early-return case, the named local being returned). String
 * vars rewrite to `kei_string_destroy`; struct vars rewrite to
 * `destroy`.
 */
function emitScopeExitDestroys(out: KirInst[], info: KirScopeExitInfo): void {
  for (let i = info.vars.length - 1; i >= 0; i--) {
    const v = info.vars[i];
    if (!v) continue;
    if (info.skipNames.has(v.name)) continue;
    if (v.isString) {
      out.push({ kind: "call_extern_void", func: "kei_string_destroy", args: [v.varId] });
    } else {
      out.push({ kind: "destroy", value: v.varId, structName: v.structName });
    }
  }
}

/**
 * Non-`mark_assign` / non-`mark_scope_exit` markers that this pass
 * currently strips without concrete rewrite. `mark_assign` and
 * `mark_scope_exit` have their own rewrite paths above.
 */
function isOtherMarker(inst: KirInst): boolean {
  switch (inst.kind) {
    case "mark_scope_enter":
    case "mark_track":
    case "mark_moved":
    case "mark_param":
      return true;
    default:
      return false;
  }
}

/**
 * Rewrite a `mark_assign slot, newValue, isMove` into the concrete
 * lifecycle sequence appropriate for the slot's pointee type:
 *
 * - Managed-struct slot — load the old value, `destroy` it, store the
 *   new value, then (unless `isMove`) `oncopy` the new value.
 * - String slot — `kei_string_destroy(slot)` then store the new value.
 *   The pointer is passed directly; no load needed (the runtime peeks
 *   through the slot).
 * - Anything else — bare `store`. The marker is a no-op for
 *   non-managed slots.
 */
function rewriteMarkAssign(
  out: KirInst[],
  inst: KirMarkAssign,
  hooks: StructHookSets,
  pointees: Map<VarId, KirType>,
  counter: { next: number }
): void {
  const pointee = pointees.get(inst.slot);

  if (pointee?.kind === "struct") {
    const structName = pointee.name;
    const hasDestroy = hooks.destroys.has(structName);
    const hasOncopy = hooks.oncopies.has(structName);
    if (hasDestroy) {
      const oldVal = `%${counter.next++}` as VarId;
      out.push({ kind: "load", dest: oldVal, ptr: inst.slot, type: pointee });
      out.push({ kind: "destroy", value: oldVal, structName });
    }
    out.push({ kind: "store", ptr: inst.slot, value: inst.newValue });
    if (hasOncopy && !inst.isMove) {
      out.push({ kind: "oncopy", value: inst.newValue, structName });
    }
    return;
  }

  if (pointee?.kind === "string") {
    out.push({ kind: "call_extern_void", func: "kei_string_destroy", args: [inst.slot] });
    out.push({ kind: "store", ptr: inst.slot, value: inst.newValue });
    return;
  }

  out.push({ kind: "store", ptr: inst.slot, value: inst.newValue });
}
