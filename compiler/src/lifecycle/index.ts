/**
 * Lifecycle module — public interface.
 *
 * First concrete instance of [ADR-0001](../../docs/adr/0001-concept-cohesive-modules.md).
 * Owns everything to do with `__destroy` / `__oncopy` hooks for managed
 * types.  Today (PR 1) only the **Decide** sub-concern lives here;
 * Synthesise and Insert follow in subsequent PRs of the migration plan
 * (`docs/design/lifecycle-module.md` §7).
 *
 * The module exposes a factory rather than a class — callers construct
 * a fresh `Lifecycle` per compile and thread it through the pipeline
 * stages that need it (today: struct-checker via decl-checker; later:
 * KIR lowering and the rewrite pass).
 */

import type { StructType } from "../checker/types";
import { runDecideFixedPoint } from "./decide";
import { synthesise } from "./synthesise";
import type { LifecycleDecision } from "./types";

export { synthesise } from "./synthesise";
export type { LifecycleDecision, ManagedFieldRef } from "./types";

/**
 * Public Lifecycle interface — a snapshot of what the module owns at
 * this stage of the migration.  Subsequent PRs will add `synthesise()`,
 * the marker rewrite pass entry point, etc.
 */
export interface Lifecycle {
  /**
   * Register a struct as a candidate for lifecycle decision.  Idempotent:
   * registering the same struct twice keeps a single entry.  Generic
   * struct templates (with non-empty `genericParams`) are accepted but
   * skipped during {@link runFixedPoint} — their concrete
   * instantiations are registered separately by monomorphization.
   */
  register(struct: StructType): void;

  /**
   * Run the fixed-point iteration over all registered structs and
   * populate the internal decision map.  Idempotent in the sense that a
   * second call after no new registrations is a no-op (the iteration
   * converges instantly), but the {@link onArmAdded} hook only fires
   * for newly-added arms, so the caller's mirror state stays
   * consistent.
   *
   * @param onArmAdded Transition shim hook — see
   *                   `docs/design/lifecycle-module.md` §7 PR 1.
   *                   Invoked once per (struct, arm) freshly added to
   *                   the decision map.  Removed in PR 4.
   */
  runFixedPoint(onArmAdded?: (struct: StructType, arm: "destroy" | "oncopy") => void): void;

  /** True if the registered struct's decision contains a `destroy` arm. */
  hasDestroy(struct: StructType): boolean;

  /** True if the registered struct's decision contains an `oncopy` arm. */
  hasOncopy(struct: StructType): boolean;

  /** The decision for `struct`, or `undefined` if no auto-generation applies. */
  getDecision(struct: StructType): LifecycleDecision | undefined;

  /**
   * Produce the auto-generated `__destroy` / `__oncopy` KIR functions for
   * `struct` given its `decision`.  Re-exported pure function — see
   * `synthesise.ts` for the contract.  Provided as a method on the
   * Lifecycle interface so KIR lowering has a single object to thread
   * through, mirroring how it consumes {@link getDecision}.
   */
  synthesise: typeof synthesise;
}

/**
 * Construct a fresh `Lifecycle` instance.
 *
 * Each compile run gets its own instance.  Decisions live in an
 * internal `Map<StructType, LifecycleDecision>` keyed by the
 * StructType identity — *not* mutated onto the type table.  See
 * design doc §6.2 for why we rejected the storage-on-StructType
 * alternative.
 */
export function createLifecycle(): Lifecycle {
  const registered: StructType[] = [];
  const registeredSet = new Set<StructType>();
  const decisions = new Map<StructType, LifecycleDecision>();

  return {
    register(struct: StructType): void {
      if (registeredSet.has(struct)) return;
      registeredSet.add(struct);
      registered.push(struct);
    },

    runFixedPoint(onArmAdded): void {
      runDecideFixedPoint(registered, decisions, onArmAdded);
    },

    hasDestroy(struct: StructType): boolean {
      return decisions.get(struct)?.destroy !== undefined;
    },

    hasOncopy(struct: StructType): boolean {
      return decisions.get(struct)?.oncopy !== undefined;
    },

    getDecision(struct: StructType): LifecycleDecision | undefined {
      return decisions.get(struct);
    },

    synthesise,
  };
}
