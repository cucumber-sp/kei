import type { ScopeId, VarId } from "./identifiers";
import type { KirFloatType, KirIntType, KirType } from "./types";

// ─── Instructions ────────────────────────────────────────────────────────────

/** Union of all KIR instructions (everything except terminators). */
export type KirInst =
  // Memory
  | KirStackAlloc
  | KirLoad
  | KirStore
  | KirFieldPtr
  | KirIndexPtr
  // Arithmetic & Comparison
  | KirBinOp
  | KirNeg
  // Logical
  | KirNot
  // Bitwise unary
  | KirBitNot
  // Constants
  | KirConstInt
  | KirConstFloat
  | KirConstBool
  | KirConstString
  | KirConstNull
  // Functions
  | KirCall
  | KirCallVoid
  | KirCallExtern
  | KirCallExternVoid
  | KirCallThrows
  // Type ops
  | KirCast
  | KirSizeof
  // Lifecycle
  | KirDestroy
  | KirOncopy
  | KirMove
  // Lifecycle markers (ephemeral — emitted by lowering, consumed by the
  // Lifecycle rewrite pass; must not survive into mem2reg).
  | KirMarkScopeEnter
  | KirMarkScopeExit
  | KirMarkTrack
  | KirMarkMoved
  | KirMarkAssign
  | KirMarkParam
  // Debug
  | KirBoundsCheck
  | KirOverflowCheck
  | KirNullCheck
  | KirAssertCheck
  | KirRequireCheck;

// ── Memory ───────────────────────────────────────────────────────────────────

/** Allocate space on the stack for a local variable; `dest` is a pointer to it. */
export interface KirStackAlloc {
  kind: "stack_alloc";
  dest: VarId;
  type: KirType;
}

/** Load a value from a pointer. */
export interface KirLoad {
  kind: "load";
  dest: VarId;
  ptr: VarId;
  type: KirType;
}

/** Store a value through a pointer. */
export interface KirStore {
  kind: "store";
  ptr: VarId;
  value: VarId;
  /** Type of the value being stored. Required for array-typed stores so the
   * C backend can emit `memcpy` (C does not allow whole-array assignment). */
  type?: KirType;
}

/** Compute a pointer to a named field within a struct. */
export interface KirFieldPtr {
  kind: "field_ptr";
  dest: VarId;
  base: VarId;
  field: string;
  type: KirType;
}

/** Compute a pointer to an element at a given index within an array. */
export interface KirIndexPtr {
  kind: "index_ptr";
  dest: VarId;
  base: VarId;
  index: VarId;
  type: KirType;
}

// ── Arithmetic, Comparison, Logical, Bitwise (binary) ────────────────────────

/** All supported binary operations. */
export type BinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "and"
  | "or"
  | "bit_and"
  | "bit_or"
  | "bit_xor"
  | "shl"
  | "shr";

/** Binary operation on two SSA values. */
export interface KirBinOp {
  kind: "bin_op";
  op: BinOp;
  dest: VarId;
  lhs: VarId;
  rhs: VarId;
  type: KirType;
  /** Operand type when it differs from result type (e.g. string eq → bool result). */
  operandType?: KirType;
}

/** Arithmetic negation (`-x`). */
export interface KirNeg {
  kind: "neg";
  dest: VarId;
  operand: VarId;
  type: KirType;
}

/** Logical NOT (`!x`). */
export interface KirNot {
  kind: "not";
  dest: VarId;
  operand: VarId;
}

/** Bitwise NOT (`~x`). */
export interface KirBitNot {
  kind: "bit_not";
  dest: VarId;
  operand: VarId;
  type: KirType;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Integer constant. */
export interface KirConstInt {
  kind: "const_int";
  dest: VarId;
  type: KirIntType;
  value: number;
}

/** Floating-point constant. */
export interface KirConstFloat {
  kind: "const_float";
  dest: VarId;
  type: KirFloatType;
  value: number;
}

/** Boolean constant (`true` / `false`). */
export interface KirConstBool {
  kind: "const_bool";
  dest: VarId;
  value: boolean;
}

/** String constant (null-terminated for C interop). */
export interface KirConstString {
  kind: "const_string";
  dest: VarId;
  value: string;
}

/** Null pointer constant. */
export interface KirConstNull {
  kind: "const_null";
  dest: VarId;
  type: KirType;
}

// ── Function calls ───────────────────────────────────────────────────────────

/** Call a function that returns a value. */
export interface KirCall {
  kind: "call";
  dest: VarId;
  func: string;
  args: VarId[];
  type: KirType;
}

/** Call a void-returning function. */
export interface KirCallVoid {
  kind: "call_void";
  func: string;
  args: VarId[];
}

/** Call an extern (FFI) function that returns a value. */
export interface KirCallExtern {
  kind: "call_extern";
  dest: VarId;
  func: string;
  args: VarId[];
  type: KirType;
}

/** Call an extern (FFI) void-returning function. */
export interface KirCallExternVoid {
  kind: "call_extern_void";
  func: string;
  args: VarId[];
}

/**
 * Call a function that uses the throws protocol.
 * The callee returns an i32 tag; `__out` and `__err` pointers are
 * appended to args by the emitter.
 */
export interface KirCallThrows {
  kind: "call_throws";
  /** Receives the i32 tag (0 = success, 1+ = error variant). */
  dest: VarId;
  func: string;
  /** Original args (before `__out`/`__err`). */
  args: VarId[];
  /** Caller-allocated buffer for the success value. */
  outPtr: VarId;
  /** Caller-allocated buffer for the error value. */
  errPtr: VarId;
  successType: KirType;
  /** Types of possible errors (for sizing the err buffer). */
  errorTypes: KirType[];
}

// ── Type operations ──────────────────────────────────────────────────────────

/** Explicit type cast between compatible types. */
export interface KirCast {
  kind: "cast";
  dest: VarId;
  value: VarId;
  targetType: KirType;
}

/** Compile-time sizeof a type (result is usize). */
export interface KirSizeof {
  kind: "sizeof";
  dest: VarId;
  type: KirType;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

/** Call the struct's `destroy` method at scope exit. */
export interface KirDestroy {
  kind: "destroy";
  value: VarId;
  structName: string;
}

/** Call the struct's `oncopy` method after an implicit copy. */
export interface KirOncopy {
  kind: "oncopy";
  value: VarId;
  structName: string;
}

/** Move a value (transfers ownership, invalidates source). */
export interface KirMove {
  kind: "move";
  dest: VarId;
  source: VarId;
  type: KirType;
}

// ── Lifecycle markers ─────────────────────────────────────────────────────
//
// Ephemeral instructions emitted by KIR lowering and consumed by the
// Lifecycle rewrite pass (see `src/lifecycle/pass.ts`). The pass walks the
// module, rewrites markers into concrete `destroy` / `oncopy` instructions
// using the Lifecycle decision map, and drops any marker that doesn't
// produce output. After the pass, no `mark_*` instruction survives — they
// are not visible to mem2reg, de-SSA, or the C emitter.
//
// Markers are deliberately type-agnostic: `mark_track` / `mark_assign`
// carry vars/slots, not types. Type is re-read off the var's KIR type at
// rewrite time. This keeps the planned String stdlib migration additive
// (string becomes just-another-managed-struct without churning marker
// shapes). See `docs/design/lifecycle-module.md` §3.

/** Open a new lexical scope frame. Paired with `mark_scope_exit`. */
export interface KirMarkScopeEnter {
  kind: "mark_scope_enter";
  scopeId: ScopeId;
}

/**
 * Close the scope frame opened by `mark_scope_enter`. The Lifecycle pass
 * emits destroys for live tracked vars in reverse declaration order,
 * skipping moved ones.
 */
export interface KirMarkScopeExit {
  kind: "mark_scope_exit";
  scopeId: ScopeId;
}

/** Register `varId` as a managed local in `scopeId`'s frame. */
export interface KirMarkTrack {
  kind: "mark_track";
  varId: VarId;
  scopeId: ScopeId;
}

/** Mark `var` as moved out — the pass skips its future scope-exit and per-param destroys. */
export interface KirMarkMoved {
  kind: "mark_moved";
  var: string;
}

/**
 * Assignment to a managed slot. The Lifecycle pass rewrites this as
 * destroy-old, store, then a conditional `oncopy` when `isMove` is false.
 */
export interface KirMarkAssign {
  kind: "mark_assign";
  slot: VarId;
  newValue: VarId;
  isMove: boolean;
}

/** Destroy `param` at every function exit. */
export interface KirMarkParam {
  kind: "mark_param";
  param: VarId;
}

// ── Debug checks ─────────────────────────────────────────────────────────────

/** Runtime array bounds check — panics if `index >= length`. */
export interface KirBoundsCheck {
  kind: "bounds_check";
  index: VarId;
  length: VarId;
}

/** Runtime integer overflow check for arithmetic operations. */
export interface KirOverflowCheck {
  kind: "overflow_check";
  op: string;
  lhs: VarId;
  rhs: VarId;
}

/** Runtime null pointer check — panics if `ptr` is null. */
export interface KirNullCheck {
  kind: "null_check";
  ptr: VarId;
}

/** Runtime assertion — panics with `message` if `cond` is false. */
export interface KirAssertCheck {
  kind: "assert_check";
  cond: VarId;
  message: string;
}

/** Runtime require check — returns error with `message` if `cond` is false. */
export interface KirRequireCheck {
  kind: "require_check";
  cond: VarId;
  message: string;
}
