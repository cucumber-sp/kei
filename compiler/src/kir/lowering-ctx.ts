/**
 * LoweringCtx — the mutable state threaded through every AST → KIR lowering pass.
 *
 * Replaces the old `KirLowerer` class + prototype-patching pattern. Every
 * `lowering-*.ts` file exports plain functions that take `ctx: LoweringCtx`
 * as their first parameter (instead of `this: KirLowerer`).
 *
 * The fields here are all mutable and progressively populated as the lowering
 * runs: per-function state (`blocks`, `currentBlockId`, …), module-level
 * collected items (`functions`, `externs`, …), and configuration (`modulePrefix`,
 * `importedNames`, …).
 */

import type { Expression, Program } from "../ast/nodes";
import type { CheckResult } from "../checker/checker";
import type { Type } from "../checker/types";
import type {
  BlockId,
  KirBlock,
  KirExtern,
  KirFunction,
  KirGlobal,
  KirInst,
  KirTerminator,
  KirType,
  KirTypeDecl,
  VarId,
} from "./kir-types";

/** A live variable inside a lowering scope — for lifecycle (`__destroy`) tracking. */
export interface ScopeVar {
  name: string;
  varId: VarId;
  /** Struct type name, used to find `__destroy` / `__oncopy`. */
  structName: string;
  /** True for string variables (use `kei_string_destroy` instead of generic destroy). */
  isString?: boolean;
}

export interface LoweringCtx {
  // ─── Inputs (effectively readonly during lowering) ────────────────────
  program: Program;
  checkResult: CheckResult;

  // ─── Per-function lowering state ──────────────────────────────────────
  blocks: KirBlock[];
  currentBlockId: BlockId;
  currentInsts: KirInst[];
  varCounter: number;
  blockCounter: number;
  /** Pending terminator for the current block; `null` when the block isn't terminated yet. */
  pendingTerminator: KirTerminator | null;

  /** Variable name → current SSA `VarId` mapping for the function being lowered. */
  varMap: Map<string, VarId>;

  /** Break / continue targets for the innermost loop (null outside loops). */
  loopBreakTarget: BlockId | null;
  loopContinueTarget: BlockId | null;
  /** Scope-stack depth captured at loop entry; break/continue destroy from this depth onward. */
  loopScopeDepth: number;

  /** Lifecycle tracking — one frame per scope, each holding the vars that need `__destroy`. */
  scopeStack: ScopeVar[][];
  /** Deferred instruction sequences — one frame per scope, each holding captured insts in push order (emitted LIFO at scope exit). */
  deferStack: KirInst[][][];
  /** Variables explicitly `move`'d — skipped at scope-exit destroy. */
  movedVars: Set<string>;

  /** Cache of `(structName) → { hasDestroy, hasOncopy }` to avoid repeated lookups. */
  structLifecycleCache: Map<string, { hasDestroy: boolean; hasOncopy: boolean }>;

  // ─── Module-level collected output ────────────────────────────────────
  functions: KirFunction[];
  externs: KirExtern[];
  typeDecls: KirTypeDecl[];
  globals: KirGlobal[];

  // ─── Name mangling / overload tracking ────────────────────────────────
  /** Function names that have multiple declarations (must be name-mangled by signature). */
  overloadedNames: Set<string>;
  /** Module prefix for multi-module builds — `"math"` produces `math_add` etc. Empty for the main module. */
  modulePrefix: string;
  /** Selective imports — local name → mangled name (e.g. `"add"` → `"math_add"`). */
  importedNames: Map<string, string>;
  /** Imported function names whose source module declares them as overloads. */
  importedOverloads: Set<string>;

  // ─── Throws protocol ──────────────────────────────────────────────────
  /** Throws types of the function currently being lowered (empty = non-throwing). */
  currentFunctionThrowsTypes: KirType[];
  /** Original return type for throws functions (before transformation to the i32 tag). */
  currentFunctionOrigReturnType: KirType;
  /** All functions known to use the throws protocol — populated in the pre-pass. */
  throwsFunctions: Map<string, { throwsTypes: KirType[]; returnType: KirType }>;

  // ─── Per-monomorphization overrides ───────────────────────────────────
  /** Per-instantiation type map override for monomorphized function bodies. */
  currentBodyTypeMap: Map<Expression, Type> | null;
  /** Per-instantiation generic resolutions override for monomorphized function bodies. */
  currentBodyGenericResolutions: Map<Expression, string> | null;
}

/**
 * Build a fresh `LoweringCtx`. Every field is initialised to its empty/default value
 * — actual content is populated as the lowering runs.
 */
export function createLoweringCtx(
  program: Program,
  checkResult: CheckResult,
  modulePrefix = "",
  importedNames?: Map<string, string>,
  importedOverloads?: Set<string>
): LoweringCtx {
  return {
    program,
    checkResult,

    blocks: [],
    currentBlockId: "entry",
    currentInsts: [],
    varCounter: 0,
    blockCounter: 0,
    pendingTerminator: null,

    varMap: new Map(),

    loopBreakTarget: null,
    loopContinueTarget: null,
    loopScopeDepth: 0,

    scopeStack: [],
    deferStack: [],
    movedVars: new Set(),

    structLifecycleCache: new Map(),

    functions: [],
    externs: [],
    typeDecls: [],
    globals: [],

    overloadedNames: new Set(),
    modulePrefix,
    importedNames: importedNames ?? new Map(),
    importedOverloads: importedOverloads ?? new Set(),

    currentFunctionThrowsTypes: [],
    currentFunctionOrigReturnType: { kind: "void" },
    throwsFunctions: new Map(),

    currentBodyTypeMap: null,
    currentBodyGenericResolutions: null,
  };
}
