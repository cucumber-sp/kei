/**
 * Monomorphization metadata: tracking which generic types/functions have been
 * instantiated.
 *
 * The monomorphization approach creates a distinct concrete type for each unique
 * set of type arguments. For example, `Box<i32>` and `Box<bool>` become two
 * separate struct types named `Box_i32` and `Box_bool`.
 */

import type { Expression, FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes";
import type { FunctionType, StructType, Type } from "../checker/types";

/**
 * Info about a monomorphized struct instance.
 *
 * Created when a generic struct like `Box<T>` is instantiated with concrete types
 * (e.g. `Box<i32>`). Stored in the checker's `monomorphizedStructs` cache, keyed
 * by the mangled name.
 */
export interface MonomorphizedStruct {
  /** The original generic struct type (with TypeParam fields). */
  original: StructType;
  /** The concrete type arguments used for this instantiation. */
  typeArgs: Type[];
  /** The fully-substituted concrete struct type. */
  concrete: StructType;
  /** Original AST declaration (needed for lowering methods). */
  originalDecl?: StructDecl | UnsafeStructDecl;
  /**
   * Per-method body type maps populated during checkMonomorphizedBodies.
   * Keyed by method name; each map records the concrete types of every
   * expression node in that method's body for this instantiation. KIR
   * lowering uses these to emit signatures and field accesses with
   * concrete types instead of the unsubstituted TypeParams.
   */
  methodBodyTypeMaps?: Map<string, Map<Expression, Type>>;
}

/**
 * Info about a monomorphized function instance.
 *
 * Created when a generic function like `identity<T>` is called with concrete types
 * (e.g. `identity<i32>(42)`). Stored in the checker's `monomorphizedFunctions` cache,
 * keyed by the mangled name.
 */
export interface MonomorphizedFunction {
  /** The original unmangled function name (e.g. `"identity"`). */
  originalName: string;
  /** The concrete type arguments used for this instantiation. */
  typeArgs: Type[];
  /** The fully-substituted concrete function type. */
  concrete: FunctionType;
  /** The mangled name for this instantiation (e.g. `"identity_i32"`). */
  mangledName: string;
  /** Original AST declaration (needed for lowering the body). */
  declaration?: FunctionDecl;
  /** Per-instantiation type map for body expressions (avoids shared-AST conflicts). */
  bodyTypeMap?: Map<Expression, Type>;
  /** Per-instantiation generic resolutions for body expressions. */
  bodyGenericResolutions?: Map<Expression, string>;
}
