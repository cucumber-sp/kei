/**
 * Monomorphization module — generic type substitution and instantiation.
 *
 * Owns the three caches (structs, functions, enums) for generic
 * instantiations as well as the cross-module adoption logic. Construct
 * one instance per compile via {@link createMonomorphization} and thread
 * it through to the {@link Checker} (and, downstream, to KIR lowering).
 *
 * Subsequent migration PRs deepen this module:
 * - PR 4: registration switches to baking fully-substituted AST decls.
 * - PR 5: deletes the per-instantiation override stack on `LoweringCtx`.
 *
 * See `docs/design/monomorphization-module.md` and
 * `docs/adr/0001-concept-cohesive-modules.md`.
 */

import type { EnumType } from "../checker/types";
import { adoptEnum, adoptFunction, adoptStruct } from "./adopt";
import { type CheckBodyCallback, checkBodies as runCheckBodies } from "./check-bodies";
import {
  type MonomorphizationStores,
  registerEnum,
  registerFunction,
  registerStruct,
} from "./register";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./types";

export { mangleGenericName } from "./mangle";
export { substituteFunctionType, substituteType } from "./substitute";
export type { CheckBodyCallback, MonomorphizedProduct } from "./check-bodies";
export type { MonomorphizedFunction, MonomorphizedStruct } from "./types";

/** Read-only view of all registered instantiations, grouped by kind. */
export interface MonomorphizationProducts {
  structs: ReadonlyMap<string, MonomorphizedStruct>;
  functions: ReadonlyMap<string, MonomorphizedFunction>;
  enums: ReadonlyMap<string, EnumType>;
}

/**
 * Public Monomorphization interface — a snapshot of what the module owns
 * at this stage of the migration.  Subsequent PRs add the pass-3 driver
 * (PR 3), AST baking (PR 4), and the override-stack deletion (PR 5).
 */
export interface Monomorphization {
  /** Record a generic struct instantiation. Keyed by mangled name. */
  registerStruct(mangledName: string, info: MonomorphizedStruct): void;

  /** Record a generic function instantiation. Keyed by mangled name. */
  registerFunction(mangledName: string, info: MonomorphizedFunction): void;

  /** Record a generic enum instantiation. Keyed by mangled name. */
  registerEnum(mangledName: string, info: EnumType): void;

  /** Lookup a struct instantiation by mangled name. */
  getMonomorphizedStruct(mangledName: string): MonomorphizedStruct | undefined;

  /** Lookup a function instantiation by mangled name. */
  getMonomorphizedFunction(mangledName: string): MonomorphizedFunction | undefined;

  /** Lookup an enum instantiation by mangled name. */
  getMonomorphizedEnum(mangledName: string): EnumType | undefined;

  /**
   * All registered instantiations grouped by kind. Read consumers (KIR
   * lowering, the multi-module orchestrator's merge phase) iterate these
   * maps.
   */
  products(): MonomorphizationProducts;

  /**
   * Adopt a single struct instantiation registered by another instance.
   * Idempotent — if the mangled name already exists, the existing entry
   * wins. Used by the multi-module orchestrator.
   */
  adoptStruct(mangledName: string, info: MonomorphizedStruct): void;

  /** Adopt a single function instantiation. Sibling of {@link adoptStruct}. */
  adoptFunction(mangledName: string, info: MonomorphizedFunction): void;

  /** Adopt a single enum instantiation. Sibling of {@link adoptStruct}. */
  adoptEnum(mangledName: string, info: EnumType): void;

  /**
   * Adopt every instantiation from `other` that this instance doesn't
   * already hold. Convenience wrapper over the per-kind adopt methods
   * for tests and bulk merges that don't need cross-module filtering.
   */
  adopt(other: Monomorphization): void;

  /**
   * Drive pass 3 — invoke `checkBody` once per registered instantiation
   * (functions first, then structs) so the caller can type-check the
   * body under that instantiation's substitution map. The per-decl
   * checking work stays in the Checker; this module owns the loop
   * (pattern-consistent with Lifecycle owning its fixed-point sweep).
   * See `docs/design/monomorphization-module.md` §3, §7.4, §8 PR 3.
   */
  checkBodies(checkBody: CheckBodyCallback): void;
}

/**
 * Construct a fresh `Monomorphization` instance. Each compile run gets
 * its own; the three maps are private to the closure.
 */
export function createMonomorphization(): Monomorphization {
  const stores: MonomorphizationStores = {
    structs: new Map(),
    functions: new Map(),
    enums: new Map(),
  };

  const products: MonomorphizationProducts = {
    structs: stores.structs,
    functions: stores.functions,
    enums: stores.enums,
  };

  const instance: Monomorphization = {
    registerStruct(mangledName, info) {
      registerStruct(stores, mangledName, info);
    },
    registerFunction(mangledName, info) {
      registerFunction(stores, mangledName, info);
    },
    registerEnum(mangledName, info) {
      registerEnum(stores, mangledName, info);
    },
    getMonomorphizedStruct(mangledName) {
      return stores.structs.get(mangledName);
    },
    getMonomorphizedFunction(mangledName) {
      return stores.functions.get(mangledName);
    },
    getMonomorphizedEnum(mangledName) {
      return stores.enums.get(mangledName);
    },
    products() {
      return products;
    },
    adoptStruct(mangledName, info) {
      adoptStruct(stores, mangledName, info);
    },
    adoptFunction(mangledName, info) {
      adoptFunction(stores, mangledName, info);
    },
    adoptEnum(mangledName, info) {
      adoptEnum(stores, mangledName, info);
    },
    adopt(other) {
      const p = other.products();
      for (const [name, info] of p.structs) adoptStruct(stores, name, info);
      for (const [name, info] of p.functions) adoptFunction(stores, name, info);
      for (const [name, info] of p.enums) adoptEnum(stores, name, info);
    },
    checkBodies(checkBody) {
      runCheckBodies(products, checkBody);
    },
  };

  return instance;
}
