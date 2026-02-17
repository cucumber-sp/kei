/**
 * KIR (Kei Intermediate Representation) node types.
 * Uses discriminated unions with a `kind` field, matching AST conventions.
 *
 * KIR is a low-level SSA-based IR that sits between the type-checked AST
 * and the C backend. It uses basic blocks with explicit terminators and
 * phi nodes for value merging at control-flow join points.
 */

// ─── Identifiers ─────────────────────────────────────────────────────────────

/** SSA variable identifier, e.g. `"%0"`, `"%x.1"`. */
export type VarId = string;

/** Basic block label, e.g. `"entry"`, `"if.then"`, `"loop.header"`. */
export type BlockId = string;

// ─── KIR Types ───────────────────────────────────────────────────────────────

/** Union of all KIR-level type representations. */
export type KirType =
  | KirIntType
  | KirFloatType
  | KirBoolType
  | KirVoidType
  | KirStringType
  | KirPtrType
  | KirStructType
  | KirEnumType
  | KirArrayType
  | KirFunctionType;

/** Fixed-width integer type in KIR. */
export interface KirIntType {
  kind: "int";
  bits: 8 | 16 | 32 | 64;
  signed: boolean;
}

/** Floating-point type in KIR. */
export interface KirFloatType {
  kind: "float";
  bits: 32 | 64;
}

/** Boolean type in KIR. */
export interface KirBoolType {
  kind: "bool";
}

/** Void type in KIR — used for functions with no return value. */
export interface KirVoidType {
  kind: "void";
}

/** String type in KIR (pointer + length). */
export interface KirStringType {
  kind: "string";
}

/** Pointer type in KIR. */
export interface KirPtrType {
  kind: "ptr";
  pointee: KirType;
}

/** Named field within a KIR struct type. */
export interface KirField {
  name: string;
  type: KirType;
}

/** Struct type in KIR — laid out as a flat sequence of named fields. */
export interface KirStructType {
  kind: "struct";
  name: string;
  fields: KirField[];
}

/** Enum variant in KIR — name, optional fields, optional discriminant. */
export interface KirVariant {
  name: string;
  fields: KirField[];
  value: number | null;
}

/** Enum type in KIR — a tagged union of variants. */
export interface KirEnumType {
  kind: "enum";
  name: string;
  variants: KirVariant[];
}

/** Fixed-length array type in KIR. */
export interface KirArrayType {
  kind: "array";
  element: KirType;
  length: number;
}

/** Function signature type in KIR (used for indirect calls). */
export interface KirFunctionType {
  kind: "function";
  params: KirType[];
  returnType: KirType;
}

// ─── Module ──────────────────────────────────────────────────────────────────

/** Top-level KIR module — the unit of compilation. */
export interface KirModule {
  name: string;
  globals: KirGlobal[];
  functions: KirFunction[];
  types: KirTypeDecl[];
  externs: KirExtern[];
}

/** Module-level global variable with optional initializer instructions. */
export interface KirGlobal {
  name: string;
  type: KirType;
  /** Instructions that compute the initial value, or null for zero-init. */
  initializer: KirInst[] | null;
}

/** Named type declaration (struct or enum) at module scope. */
export interface KirTypeDecl {
  name: string;
  type: KirStructType | KirEnumType;
}

/** External (FFI) function declaration — no body. */
export interface KirExtern {
  name: string;
  params: KirParam[];
  returnType: KirType;
}

// ─── Function ────────────────────────────────────────────────────────────────

/** A KIR function — a list of basic blocks in SSA form. */
export interface KirFunction {
  name: string;
  params: KirParam[];
  returnType: KirType;
  blocks: KirBlock[];
  localCount: number;
  /**
   * If non-empty, this function uses the throws protocol:
   * actual return type is i32 (tag), with `__out` and `__err` out-pointers
   * appended to params.
   */
  throwsTypes?: KirType[];
}

/** Named function parameter. */
export interface KirParam {
  name: string;
  type: KirType;
}

// ─── Basic Block ─────────────────────────────────────────────────────────────

/**
 * A basic block — a straight-line sequence of instructions ending with
 * exactly one terminator. May have phi nodes at the top for SSA merges.
 */
export interface KirBlock {
  id: BlockId;
  phis: KirPhi[];
  instructions: KirInst[];
  terminator: KirTerminator;
}

// ─── Phi Node ────────────────────────────────────────────────────────────────

/** SSA phi node — selects a value based on which predecessor block executed. */
export interface KirPhi {
  dest: VarId;
  type: KirType;
  incoming: { value: VarId; from: BlockId }[];
}

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
  | "add" | "sub" | "mul" | "div" | "mod"
  | "eq" | "neq" | "lt" | "gt" | "lte" | "gte"
  | "and" | "or"
  | "bit_and" | "bit_or" | "bit_xor" | "shl" | "shr";

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

// ─── Terminators ─────────────────────────────────────────────────────────────

/** Union of all block terminators — exactly one per basic block. */
export type KirTerminator =
  | KirRet
  | KirRetVoid
  | KirJump
  | KirBranch
  | KirSwitch
  | KirUnreachable;

/** Return a value from the function. */
export interface KirRet {
  kind: "ret";
  value: VarId;
}

/** Return void from the function. */
export interface KirRetVoid {
  kind: "ret_void";
}

/** Unconditional jump to a target block. */
export interface KirJump {
  kind: "jump";
  target: BlockId;
}

/** Conditional branch — jumps to `thenBlock` if `cond` is true, else `elseBlock`. */
export interface KirBranch {
  kind: "br";
  cond: VarId;
  thenBlock: BlockId;
  elseBlock: BlockId;
}

/** Multi-way switch on an integer value with a default fallthrough. */
export interface KirSwitch {
  kind: "switch";
  value: VarId;
  cases: { value: VarId; target: BlockId }[];
  defaultBlock: BlockId;
}

/** Marks unreachable code (e.g. after a guaranteed return/panic). */
export interface KirUnreachable {
  kind: "unreachable";
}
