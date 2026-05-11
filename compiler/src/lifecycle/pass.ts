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
 *   lower to `destroy`.
 * - PR 4b — `mark_assign` rewrites into load/destroy/store/oncopy
 *   (the slot's pointee KIR type drives the dispatch).
 * - PR 4c — `mark_param` rewrites into per-exit destroys.
 * - PR 4d — `mark_moved x` is consumed by the rewriter into a
 *   per-function moved-set (walked in source order). The set is
 *   consulted when emitting destroys at `mark_scope_exit` and the
 *   per-exit param destroys, skipping any moved var.
 * - PR 4e — `mark_track` + `mark_scope_enter` are the source of
 *   truth for scope → tracked vars: the pass walks each function's
 *   marker stream pre-rewrite to build `Map<scopeId, TrackedVar[]>`,
 *   then reads it back at every `mark_scope_exit`. The skip-set still
 *   comes from the transitional `KirFunction.lifecycleScopeExits`
 *   side-table for early-return retained-name skips.
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
  ScopeId,
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

/** A var tracked by `mark_track`, expanded with the type info needed to destroy it. */
interface TrackedVar {
  name: string;
  varId: VarId;
  /** Mangled struct name for `destroy`; empty when `isString`. */
  structName: string;
  isString: boolean;
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
 * `mark_scope_exit scope_id` is rewritten into reverse-order destroys
 * for the tracked vars in that scope (read from a pre-pass over
 * `mark_track` markers in the same function), skipping any var named in
 * the matching `skipNames` set from the transitional side-table.
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
  // Drives both the `mark_assign` rewrite (slot's pointee type) and the
  // `mark_track` rewrite (var's pointee tells us string vs. struct).
  const pointees = collectPointeeTypes(fn);

  // Pre-pass: build `scopeId → TrackedVar[]` from `mark_track` markers,
  // in source/declaration order. The `mark_scope_exit` rewrite reads
  // this back and emits destroys in reverse.
  const scopeVars = collectScopeTrackedVars(fn, pointees);

  // The mark_assign rewrite may inject `load` instructions. Those need
  // fresh VarIds; start numbering at `fn.localCount` so they don't
  // collide with names lowering already used.
  const counter = { next: fn.localCount };

  const scopeExits = fn.lifecycleScopeExits;

  // Per-function moved-set, built incrementally as the rewriter walks
  // blocks in source order. `mark_moved x` adds `x`; `mark_scope_exit`
  // and per-exit param destroys read it to skip moved vars.
  const moved = new Set<string>();

  const blocks = fn.blocks.map((block) =>
    rewriteBlock(block, hooks, pointees, counter, paramDestroys, scopeExits, scopeVars, moved)
  );
  // The side-table is consumed here; downstream passes (mem2reg, de-SSA,
  // C emitter) never see it.
  const { lifecycleScopeExits: _, ...rest } = fn;
  return { ...rest, blocks, localCount: counter.next };
}

/**
 * Walk every block, find each `mark_param`, and resolve its struct name
 * from the function's `params` list. Returns the destroy candidates that
 * must fire before every exit terminator, in marker-emission order
 * (params don't carry the reverse-declaration-order spec invariant —
 * that's locals only, per spec §6.9).
 *
 * Each candidate carries the param's source-level `name` so the
 * per-exit emission can consult the moved-set and skip a moved param.
 *
 * Managed-struct params lower to `ptr → struct`: KIR wraps a struct-typed
 * param in a pointer so `field_ptr` always operates on a base pointer.
 * The struct name lives on the pointee.
 */
interface ParamDestroyCandidate {
  name: string;
  inst: KirInst;
}

function collectParamDestroys(fn: KirFunction): ParamDestroyCandidate[] {
  const paramByVarId = new Map<VarId, { name: string; structName: string }>();
  for (const p of fn.params) {
    if (p.type.kind !== "ptr") continue;
    if (p.type.pointee.kind !== "struct") continue;
    paramByVarId.set(`%${p.name}`, { name: p.name, structName: mangledStructName(p.type.pointee) });
  }

  const destroys: ParamDestroyCandidate[] = [];
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind !== "mark_param") continue;
      const info = paramByVarId.get(inst.param);
      if (!info) continue;
      destroys.push({
        name: info.name,
        inst: { kind: "destroy", value: inst.param, structName: info.structName },
      });
    }
  }
  return destroys;
}

/**
 * Walk every instruction in `fn` and collect the pointee KIR type for
 * each pointer-producing instruction (`stack_alloc`, `field_ptr`,
 * `index_ptr`). The pass uses this to recover the slot's pointee type
 * when rewriting a `mark_assign` or `mark_track` marker.
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

/**
 * Walk `mark_track` markers across every block and bucket them by
 * `scopeId`. Each marker contributes a `TrackedVar` whose
 * `structName` / `isString` is read from the var's pointee type
 * (collected by `collectPointeeTypes`).
 *
 * A marker with no resolvable pointee (or one that doesn't point to
 * a managed type) is silently dropped — lowering only emits
 * `mark_track` for managed locals, but defending here means a
 * malformed marker can't synthesise a phantom destroy.
 */
function collectScopeTrackedVars(
  fn: KirFunction,
  pointees: Map<VarId, KirType>
): Map<ScopeId, TrackedVar[]> {
  const scopeVars = new Map<ScopeId, TrackedVar[]>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind !== "mark_track") continue;
      const pointee = pointees.get(inst.varId);
      if (!pointee) continue;
      const tracked = trackedVarFromPointee(inst.varId, inst.name, pointee);
      if (!tracked) continue;
      const list = scopeVars.get(inst.scopeId);
      if (list) {
        list.push(tracked);
      } else {
        scopeVars.set(inst.scopeId, [tracked]);
      }
    }
  }
  return scopeVars;
}

/** Map a `mark_track`'s pointee KIR type to a `TrackedVar`, or `null` for unmanaged types. */
function trackedVarFromPointee(varId: VarId, name: string, pointee: KirType): TrackedVar | null {
  if (pointee.kind === "string") {
    return { name, varId, structName: "", isString: true };
  }
  if (pointee.kind === "struct") {
    return { name, varId, structName: mangledStructName(pointee), isString: false };
  }
  return null;
}

/**
 * Reconstruct the destroy/oncopy symbol prefix for a `KirStructType`:
 * `<modulePrefix>_<name>` for cross-module structs, bare `<name>` for
 * main-module or generic-monomorphized structs. Matches the convention
 * used by `lowering-scope.mangledLifecycleStructName` and the
 * synthesised hook bodies.
 */
function mangledStructName(t: { name: string; modulePrefix?: string }): string {
  return t.modulePrefix ? `${t.modulePrefix}_${t.name}` : t.name;
}

function rewriteBlock(
  block: KirBlock,
  hooks: StructHookSets,
  pointees: Map<VarId, KirType>,
  counter: { next: number },
  paramDestroys: ParamDestroyCandidate[],
  scopeExits: ReadonlyMap<ScopeId, KirScopeExitInfo> | undefined,
  scopeVars: ReadonlyMap<ScopeId, TrackedVar[]>,
  moved: Set<string>
): KirBlock {
  const out: KirInst[] = [];
  for (const inst of block.instructions) {
    if (inst.kind === "mark_moved") {
      moved.add(inst.var);
      continue;
    }
    if (inst.kind === "mark_assign") {
      rewriteMarkAssign(out, inst, hooks, pointees, counter);
      continue;
    }
    if (inst.kind === "mark_scope_exit") {
      const vars = scopeVars.get(inst.scopeId);
      const skipNames = scopeExits?.get(inst.scopeId)?.skipNames;
      if (vars) emitScopeExitDestroys(out, vars, skipNames, moved);
      continue;
    }
    if (isOtherMarker(inst)) continue;
    out.push(inst);
  }
  // Append per-exit param destroys if this block ends with a function
  // exit terminator (ret / ret_void). Moved params are skipped.
  if (isExitTerminator(block.terminator)) {
    for (const candidate of paramDestroys) {
      if (moved.has(candidate.name)) continue;
      out.push(candidate.inst);
    }
  }
  return { ...block, instructions: out };
}

/** Function exits (`ret` / `ret_void`) trigger param destroys; other terminators don't. */
function isExitTerminator(t: KirTerminator): boolean {
  return t.kind === "ret" || t.kind === "ret_void";
}

/**
 * Emit destroys for `vars` in reverse declaration order, skipping any
 * var whose name appears in `skipNames` (the early-return case — the
 * named local being returned) or in the per-function `moved` set
 * (vars moved out by `mark_moved`). String vars rewrite to
 * `kei_string_destroy`; struct vars rewrite to `destroy`.
 */
function emitScopeExitDestroys(
  out: KirInst[],
  vars: readonly TrackedVar[],
  skipNames: ReadonlySet<string> | undefined,
  moved: ReadonlySet<string>
): void {
  for (let i = vars.length - 1; i >= 0; i--) {
    const v = vars[i];
    if (!v) continue;
    if (skipNames?.has(v.name)) continue;
    if (moved.has(v.name)) continue;
    if (v.isString) {
      out.push({ kind: "call_extern_void", func: "kei_string_destroy", args: [v.varId] });
    } else {
      out.push({ kind: "destroy", value: v.varId, structName: v.structName });
    }
  }
}

/**
 * Markers that this pass strips without concrete rewrite at the
 * instruction site. `mark_assign`, `mark_scope_exit`, and `mark_moved`
 * have their own rewrite paths above.
 */
function isOtherMarker(inst: KirInst): boolean {
  switch (inst.kind) {
    case "mark_scope_enter":
    case "mark_track":
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
    const structName = mangledStructName(pointee);
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
