/**
 * Monomorphization module — generic type substitution and instantiation.
 *
 * Handles the core mechanics of Kei's generics system:
 * - Type substitution: replacing type parameters (e.g. `T`) with concrete types
 * - Name mangling: generating unique names for monomorphized instances
 * - Monomorphization metadata: tracking which generic types/functions have been
 *   instantiated
 *
 * See `docs/design/monomorphization-module.md` and
 * `docs/adr/0001-concept-cohesive-modules.md`.
 */

export { mangleGenericName } from "./mangle";
export { substituteFunctionType, substituteType } from "./substitute";
export type { MonomorphizedFunction, MonomorphizedStruct } from "./types";
