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
 * **Y-a-clone bake (PR 4 — design doc §4).** Before each callback,
 * this driver bakes a fully-substituted AST clone of the template via
 * {@link bake} and attaches it to the product (`bakedDecl`). The
 * callback (i.e. the Checker's per-decl primitive) then walks the
 * clone, populating `Checker.typeMap` keyed by the cloned expression
 * identities. KIR lowering also walks the clone, so the type reads
 * hit the clone-keyed entries naturally — no per-instantiation
 * override needed.
 *
 * See `docs/design/monomorphization-module.md` §3 (`check-bodies.ts`),
 * §4 (Y-a-clone), §8 PR 3 and PR 4.
 */

import type { Declaration } from "../ast/nodes";
import { bake } from "./bake";
import type { MonomorphizationProducts } from "./index";
import { buildTypeSubstitutionMap } from "./substitute";
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
 *
 * Before invoking the callback for an instantiation that has an
 * original AST decl attached, this driver bakes a fully-substituted
 * AST clone and stashes it on the product as `bakedDecl`. The clone is
 * what the callback (and, downstream, KIR lowering) walks.
 */
export function checkBodies(
  products: MonomorphizationProducts,
  checkBody: CheckBodyCallback
): void {
  for (const monoFunc of products.functions.values()) {
    bakeFunctionIfNeeded(monoFunc);
    checkBody({ kind: "function", product: monoFunc });
  }
  for (const monoStruct of products.structs.values()) {
    bakeStructIfNeeded(monoStruct);
    checkBody({ kind: "struct", product: monoStruct });
  }
}

function bakeFunctionIfNeeded(monoFunc: MonomorphizedFunction): void {
  if (monoFunc.bakedDecl !== undefined) return;
  if (!monoFunc.declaration) return;
  const subs = buildTypeSubstitutionMap(monoFunc.declaration.genericParams, monoFunc.typeArgs);
  const cloned = bake(monoFunc.declaration as Declaration, subs);
  // `bake` preserves the declaration kind; narrow back to FunctionDecl.
  if (cloned.kind === "FunctionDecl") monoFunc.bakedDecl = cloned;
}

function bakeStructIfNeeded(monoStruct: MonomorphizedStruct): void {
  if (monoStruct.bakedDecl !== undefined) return;
  if (!monoStruct.originalDecl) return;
  const subs = buildTypeSubstitutionMap(monoStruct.originalDecl.genericParams, monoStruct.typeArgs);
  const cloned = bake(monoStruct.originalDecl as Declaration, subs);
  if (cloned.kind === "StructDecl" || cloned.kind === "UnsafeStructDecl") {
    monoStruct.bakedDecl = cloned;
  }
}
