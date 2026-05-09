/**
 * Lifecycle module — Decision record types.
 *
 * The {@link LifecycleDecision} is the bridge between checker-time existence
 * queries (`hasDestroy(struct)` / `hasOncopy(struct)`) and lowering-time
 * body synthesis (PR 2). It records *which* fields drive auto-generation,
 * not the order they should be visited — field-iteration order
 * (reverse-declaration per spec §6.9) is the module's invariant, applied at
 * synthesise time, so callers can't accidentally produce wrong-order
 * destroys.
 *
 * See `docs/design/lifecycle-module.md` §4.
 */

/**
 * A reference to a managed field on a struct. Holds only the field name —
 * the type is re-resolved against the owning struct at synthesise time,
 * after monomorphization has produced concrete types for any generic
 * parameters.
 */
export interface ManagedFieldRef {
  name: string;
}

/**
 * The decision reached for a single struct. Either or both arms may be
 * present:
 *
 * - `destroy` — the struct needs an auto-generated `__destroy` hook.
 * - `oncopy`  — the struct needs an auto-generated `__oncopy` hook.
 *
 * A struct that has an explicit user-written hook for either arm gets no
 * decision for that arm (user wins; no auto-generation).
 *
 * A struct with neither managed nor copyable fields produces no decision
 * at all (i.e. is absent from the Lifecycle map).
 */
export interface LifecycleDecision {
  destroy?: { fields: ManagedFieldRef[] };
  oncopy?: { fields: ManagedFieldRef[] };
}
