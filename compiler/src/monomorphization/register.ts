/**
 * Discovery — recording generic instantiations into a Monomorphization
 * instance's internal maps.
 *
 * At this stage of the migration (PR 2 of
 * `docs/design/monomorphization-module.md`) callers in
 * `checker/literal-checker.ts` and `checker/call-checker.ts` still build
 * the `MonomorphizedStruct` / `MonomorphizedFunction` records themselves
 * and hand the finished record off here. PR 4 inverts the direction:
 * callers will pass `(decl, typeArgs)` and this module will bake the
 * fully-substituted AST decl. For now, registration is "set in the right
 * map keyed by mangled name."
 */

import type { EnumType } from "../checker/types";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./types";

/** Internal storage shared between {@link createMonomorphization}'s closures. */
export interface MonomorphizationStores {
  structs: Map<string, MonomorphizedStruct>;
  functions: Map<string, MonomorphizedFunction>;
  enums: Map<string, EnumType>;
}

export function registerStruct(
  stores: MonomorphizationStores,
  mangledName: string,
  info: MonomorphizedStruct
): void {
  stores.structs.set(mangledName, info);
}

export function registerFunction(
  stores: MonomorphizationStores,
  mangledName: string,
  info: MonomorphizedFunction
): void {
  stores.functions.set(mangledName, info);
}

export function registerEnum(
  stores: MonomorphizationStores,
  mangledName: string,
  info: EnumType
): void {
  stores.enums.set(mangledName, info);
}
