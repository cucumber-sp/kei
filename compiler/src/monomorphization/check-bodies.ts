/**
 * Monomorphization module — pass-3 body-check driver.
 *
 * Iterates the registered instantiations and invokes the supplied
 * callback once per product so the checker can type-check the body
 * under that instantiation's substitution map.  The actual per-decl
 * work (scope setup, substitutions, statement walking) stays in the
 * Checker — the callback is the seam.  Only the loop ordering and
 * the iteration contract live here.
 *
 * Pattern-consistency with Lifecycle: Lifecycle owns its fixed-point
 * sweep over registered structs; Monomorphization owns its sweep over
 * registered instantiations.  Every ADR-0001 concept module owns its
 * own loops; the Checker is the convener (see design doc §7.4).
 *
 * Ordering note: functions are visited before structs, matching the
 * historical pass-3 ordering on `Checker`.  KIR lowering doesn't
 * depend on this order, but preserving it keeps the migration
 * behaviour-preserving.
 *
 * See `docs/design/monomorphization-module.md` §3 (`check-bodies.ts`)
 * and §8 PR 3.
 */

import type { MonomorphizationProducts } from "./index";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./types";

/**
 * Discriminated union threaded through {@link CheckBodyCallback}.  The
 * callback dispatches on `kind`; per-instantiation work that's
 * specific to functions vs structs stays inside the checker.
 */
export type MonomorphizedProduct =
  | { kind: "function"; product: MonomorphizedFunction }
  | { kind: "struct"; product: MonomorphizedStruct };

/** Callback the driver invokes once per registered instantiation. */
export type CheckBodyCallback = (product: MonomorphizedProduct) => void;

/**
 * Walk every registered instantiation and invoke `checkBody` for each.
 * Functions are visited first (matching the historical order on
 * `Checker`); structs follow.
 */
export function checkBodies(
  products: MonomorphizationProducts,
  checkBody: CheckBodyCallback
): void {
  for (const monoFunc of products.functions.values()) {
    checkBody({ kind: "function", product: monoFunc });
  }
  for (const monoStruct of products.structs.values()) {
    checkBody({ kind: "struct", product: monoStruct });
  }
}
