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
 * (e.g. `Box<i32>`). Stored in the Monomorphization module's struct registry,
 * keyed by the mangled name.
 */
export interface MonomorphizedStruct {
  /** The original generic struct type (with TypeParam fields). */
  original: StructType;
  /** The concrete type arguments used for this instantiation. */
  typeArgs: Type[];
  /** The fully-substituted concrete struct type. */
  concrete: StructType;
  /**
   * Original AST declaration (the generic template). Backfilled by the
   * pass-3 body-check driver if not provided at register time. Kept for
   * the cross-module orchestrator's "where did this come from?" routing;
   * KIR lowering walks {@link bakedDecl} instead.
   */
  originalDecl?: StructDecl | UnsafeStructDecl;
  /**
   * The fully-substituted AST clone produced by `bake.ts` (Path A,
   * design doc §4). Created lazily by `Monomorphization.checkBodies`
   * just before invoking the body-check callback. KIR lowering walks
   * this clone (not {@link originalDecl}); the global `Checker.typeMap`
   * carries entries keyed by the cloned expression identities, populated
   * by the pass-3 body-check re-walk.
   */
  bakedDecl?: StructDecl | UnsafeStructDecl;
  /**
   * Per-method body type maps populated during the pass-3 body-check sweep.
   * Keyed by method name; each map records the concrete types of every
   * expression node in that method's body for this instantiation.
   *
   * Retained as a transition shim — KIR lowering reads from the global
   * `Checker.typeMap` by clone identity now that bodies are checked
   * against the bake clone. The override stack on `LoweringCtx` (which
   * this map feeds) becomes a no-op for synthesised decls in PR 4 and
   * gets deleted entirely in PR 5.
   */
  methodBodyTypeMaps?: Map<string, Map<Expression, Type>>;
}

/**
 * Info about a monomorphized function instance.
 *
 * Created when a generic function like `identity<T>` is called with concrete types
 * (e.g. `identity<i32>(42)`). Stored in the Monomorphization module's function
 * registry, keyed by the mangled name.
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
  /**
   * Original AST declaration (the generic template). Backfilled by the
   * pass-3 body-check driver if not provided at register time. Kept so
   * the cross-module orchestrator can route adoptions by defining
   * module; KIR lowering walks {@link bakedDecl} instead.
   */
  declaration?: FunctionDecl;
  /**
   * The fully-substituted AST clone produced by `bake.ts` (Path A,
   * design doc §4). Created lazily by `Monomorphization.checkBodies`
   * just before invoking the body-check callback. KIR lowering walks
   * this clone (not {@link declaration}); the global `Checker.typeMap`
   * carries entries keyed by the cloned expression identities, populated
   * by the pass-3 body-check re-walk.
   */
  bakedDecl?: FunctionDecl;
  /**
   * Per-instantiation type map for body expressions. Retained as a
   * transition shim — KIR lowering reads from the global
   * `Checker.typeMap` by clone identity now. The override stack on
   * `LoweringCtx` (which this map feeds) becomes a no-op for synthesised
   * decls in PR 4 and gets deleted entirely in PR 5.
   */
  bodyTypeMap?: Map<Expression, Type>;
  /** Per-instantiation generic resolutions for body expressions. Same transition-shim note as {@link bodyTypeMap}. */
  bodyGenericResolutions?: Map<Expression, string>;
}
