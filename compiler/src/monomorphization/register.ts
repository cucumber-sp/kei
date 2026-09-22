/**
 * Record generic instantiations in the module's internal maps.
 * Callers supply the records; the body-check pass later attaches baked
 * declarations for KIR lowering.
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
