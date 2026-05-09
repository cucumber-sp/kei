/**
 * Cross-module merge — pulling in instantiations registered by another
 * Monomorphization instance.
 *
 * Used by the multi-module orchestrator: when module B instantiates
 * `Foo<i32>` for a generic struct defined in module A, we route the
 * instantiation back to A's checker so its body type-checks under A's
 * scope (where A's imports are visible). The merge is by mangled name —
 * if both instances already hold `Foo_i32`, the existing entry wins.
 */

import type { EnumType } from "../checker/types";
import type { MonomorphizationStores } from "./register";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./types";

export function adoptStruct(
  stores: MonomorphizationStores,
  mangledName: string,
  info: MonomorphizedStruct
): void {
  if (!stores.structs.has(mangledName)) {
    stores.structs.set(mangledName, info);
  }
}

export function adoptFunction(
  stores: MonomorphizationStores,
  mangledName: string,
  info: MonomorphizedFunction
): void {
  if (!stores.functions.has(mangledName)) {
    stores.functions.set(mangledName, info);
  }
}

export function adoptEnum(
  stores: MonomorphizationStores,
  mangledName: string,
  info: EnumType
): void {
  if (!stores.enums.has(mangledName)) {
    stores.enums.set(mangledName, info);
  }
}
