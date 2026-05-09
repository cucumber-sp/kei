/**
 * Lifecycle module — Decide sub-concern.
 *
 * Fixed-point iteration over a registered set of structs that determines
 * which ones need an auto-generated `__destroy` and/or `__oncopy` hook.
 *
 * Why fixed-point: struct A's destroy depends on whether B has destroy,
 * which depends on C, etc. A single pass over the set is not enough —
 * decisions ripple.  Each iteration asks every still-undecided struct
 * "do you have a managed/copyable field?", using the current decisions
 * (plus user-written hooks already on the struct's type) as the answer
 * for nested struct fields. Iteration stops when no struct flips.
 *
 * Termination: each iteration can only *add* an arm to a decision (never
 * remove); the decision space is bounded by `2 * |structs|` total arms,
 * so termination is guaranteed in `O(|structs|)` iterations.
 *
 * See `docs/design/lifecycle-module.md` §2 ("Decide") and §4.
 */

import type { StructType, Type } from "../checker/types";
import { TypeKind } from "../checker/types";
import type { LifecycleDecision, ManagedFieldRef } from "./types";

/**
 * Predicate used during fixed-point iteration: does a field's type carry
 * a destroy obligation?  String fields always do.  Struct fields do if
 * either the field-type's struct has a `__destroy` method registered
 * (user-written, or mirrored back by the struct-checker shim during
 * the migration — see `docs/design/lifecycle-module.md` §7 PR 1) **or**
 * the field-type's struct already has a destroy decision in the current
 * decision map. The decision map is the authoritative record; the
 * `methods` check covers user-written hooks and stays load-bearing
 * until PR 4 retires the mirror.
 */
function fieldNeedsDestroy(
  fieldType: Type,
  decisions: Map<StructType, LifecycleDecision>
): boolean {
  if (fieldType.kind === TypeKind.String) return true;
  if (fieldType.kind === TypeKind.Struct) {
    if (fieldType.methods.has("__destroy")) return true;
    if (decisions.get(fieldType)?.destroy !== undefined) return true;
  }
  return false;
}

/** Sibling of {@link fieldNeedsDestroy} for the copy hook. */
function fieldNeedsOncopy(fieldType: Type, decisions: Map<StructType, LifecycleDecision>): boolean {
  if (fieldType.kind === TypeKind.String) return true;
  if (fieldType.kind === TypeKind.Struct) {
    if (fieldType.methods.has("__oncopy")) return true;
    if (decisions.get(fieldType)?.oncopy !== undefined) return true;
  }
  return false;
}

/**
 * Collect the {@link ManagedFieldRef}s for a struct that drive an arm of
 * the decision.  Field iteration order follows declaration order (spec
 * §6.9 reverse-declaration is the *synthesise* invariant, not the
 * decide one — synthesise is free to re-order the fields it gets).
 */
function collectManagedFields(
  structType: StructType,
  predicate: (fieldType: Type) => boolean
): ManagedFieldRef[] {
  const refs: ManagedFieldRef[] = [];
  for (const [name, fieldType] of structType.fields) {
    if (predicate(fieldType)) refs.push({ name });
  }
  return refs;
}

/**
 * Run the fixed-point iteration over `structs`. Mutates `decisions` in
 * place: structs that need an auto hook get an entry; structs that
 * already have a user-written hook for a given arm are skipped for that
 * arm (the user-written one wins).
 *
 * The iteration is split into two phases — destroys first, then
 * oncopies — to mirror the historical pass-1.5 ordering and to keep
 * the per-arm semantics independently testable.  Each phase is its own
 * fixed point; an oncopy decision can depend on a previous-phase
 * destroy decision via the `methods` mirror (struct-checker writes it
 * back as a transition shim).
 *
 * @param structs    Structs to consider, in source order.
 * @param decisions  Decision map keyed by `StructType`; mutated in place.
 * @param onArmAdded Optional hook invoked when an arm is freshly added
 *                   to a struct's decision.  Lets callers (today: the
 *                   struct-checker shim) mirror the decision back onto
 *                   `structType.methods` so type-checking call sites
 *                   that reference `s.__destroy()` / `s.__oncopy()` keep
 *                   working.  Removed in PR 4 once Diagnostics-style
 *                   queries replace the type-table lookups.
 */
export function runDecideFixedPoint(
  structs: readonly StructType[],
  decisions: Map<StructType, LifecycleDecision>,
  onArmAdded?: (struct: StructType, arm: "destroy" | "oncopy") => void
): void {
  // Phase 1 — destroys.
  let changed = true;
  while (changed) {
    changed = false;
    for (const structType of structs) {
      // Skip generic templates — handled at monomorphization time.
      if (structType.genericParams.length > 0) continue;
      // User-written destroy → leave it alone.  Already-decided destroy
      // → also skip (the decision map is the authoritative record; the
      // `methods` mirror exists for transition only, see module
      // docstring).
      if (decisions.get(structType)?.destroy !== undefined) continue;
      if (structType.methods.has("__destroy")) continue;

      const fields = collectManagedFields(structType, (t) => fieldNeedsDestroy(t, decisions));
      if (fields.length === 0) continue;

      const existing = decisions.get(structType) ?? {};
      decisions.set(structType, { ...existing, destroy: { fields } });
      onArmAdded?.(structType, "destroy");
      changed = true;
    }
  }

  // Phase 2 — oncopies.
  changed = true;
  while (changed) {
    changed = false;
    for (const structType of structs) {
      if (structType.genericParams.length > 0) continue;
      if (decisions.get(structType)?.oncopy !== undefined) continue;
      if (structType.methods.has("__oncopy")) continue;

      const fields = collectManagedFields(structType, (t) => fieldNeedsOncopy(t, decisions));
      if (fields.length === 0) continue;

      const existing = decisions.get(structType) ?? {};
      decisions.set(structType, { ...existing, oncopy: { fields } });
      onArmAdded?.(structType, "oncopy");
      changed = true;
    }
  }
}
