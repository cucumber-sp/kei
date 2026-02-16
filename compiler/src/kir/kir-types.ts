/**
 * KIR (Kei Intermediate Representation) node types.
 * Uses discriminated unions with a `kind` field, matching AST conventions.
 */

// ─── Identifiers ─────────────────────────────────────────────────────────────

/** SSA variable identifier, e.g. "%0", "%x.1" */
export type VarId = string;

/** Basic block label, e.g. "entry", "if.then", "loop.header" */
export type BlockId = string;

// ─── KIR Types ───────────────────────────────────────────────────────────────

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

export interface KirIntType {
  kind: "int";
  bits: 8 | 16 | 32 | 64;
  signed: boolean;
}

export interface KirFloatType {
  kind: "float";
  bits: 32 | 64;
}

export interface KirBoolType {
  kind: "bool";
}

export interface KirVoidType {
  kind: "void";
}

export interface KirStringType {
  kind: "string";
}

export interface KirPtrType {
  kind: "ptr";
  pointee: KirType;
}

export interface KirField {
  name: string;
  type: KirType;
}

export interface KirStructType {
  kind: "struct";
  name: string;
  fields: KirField[];
}

export interface KirVariant {
  name: string;
  fields: KirField[];
  value: number | null;
}

export interface KirEnumType {
  kind: "enum";
  name: string;
  variants: KirVariant[];
}

export interface KirArrayType {
  kind: "array";
  element: KirType;
  length: number;
}

export interface KirFunctionType {
  kind: "function";
  params: KirType[];
  returnType: KirType;
}

// ─── Module ──────────────────────────────────────────────────────────────────

export interface KirModule {
  name: string;
  globals: KirGlobal[];
  functions: KirFunction[];
  types: KirTypeDecl[];
  externs: KirExtern[];
}

export interface KirGlobal {
  name: string;
  type: KirType;
  initializer: KirInst[] | null;
}

export interface KirTypeDecl {
  name: string;
  type: KirStructType | KirEnumType;
}

export interface KirExtern {
  name: string;
  params: KirParam[];
  returnType: KirType;
}

// ─── Function ────────────────────────────────────────────────────────────────

export interface KirFunction {
  name: string;
  params: KirParam[];
  returnType: KirType;
  blocks: KirBlock[];
  localCount: number;
}

export interface KirParam {
  name: string;
  type: KirType;
}

// ─── Basic Block ─────────────────────────────────────────────────────────────

export interface KirBlock {
  id: BlockId;
  phis: KirPhi[];
  instructions: KirInst[];
  terminator: KirTerminator;
}

// ─── Phi Node ────────────────────────────────────────────────────────────────

export interface KirPhi {
  dest: VarId;
  type: KirType;
  incoming: { value: VarId; from: BlockId }[];
}

// ─── Instructions ────────────────────────────────────────────────────────────

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
  // Type ops
  | KirCast
  | KirSizeof
  // Debug
  | KirBoundsCheck
  | KirOverflowCheck
  | KirNullCheck
  | KirAssertCheck
  | KirRequireCheck;

// ── Memory ───────────────────────────────────────────────────────────────────

export interface KirStackAlloc {
  kind: "stack_alloc";
  dest: VarId;
  type: KirType;
}

export interface KirLoad {
  kind: "load";
  dest: VarId;
  ptr: VarId;
  type: KirType;
}

export interface KirStore {
  kind: "store";
  ptr: VarId;
  value: VarId;
}

export interface KirFieldPtr {
  kind: "field_ptr";
  dest: VarId;
  base: VarId;
  field: string;
  type: KirType;
}

export interface KirIndexPtr {
  kind: "index_ptr";
  dest: VarId;
  base: VarId;
  index: VarId;
  type: KirType;
}

// ── Arithmetic, Comparison, Logical, Bitwise (binary) ────────────────────────

export type BinOp =
  | "add" | "sub" | "mul" | "div" | "mod"
  | "eq" | "neq" | "lt" | "gt" | "lte" | "gte"
  | "and" | "or"
  | "bit_and" | "bit_or" | "bit_xor" | "shl" | "shr";

export interface KirBinOp {
  kind: "bin_op";
  op: BinOp;
  dest: VarId;
  lhs: VarId;
  rhs: VarId;
  type: KirType;
}

export interface KirNeg {
  kind: "neg";
  dest: VarId;
  operand: VarId;
  type: KirType;
}

export interface KirNot {
  kind: "not";
  dest: VarId;
  operand: VarId;
}

export interface KirBitNot {
  kind: "bit_not";
  dest: VarId;
  operand: VarId;
  type: KirType;
}

// ── Constants ────────────────────────────────────────────────────────────────

export interface KirConstInt {
  kind: "const_int";
  dest: VarId;
  type: KirIntType;
  value: number;
}

export interface KirConstFloat {
  kind: "const_float";
  dest: VarId;
  type: KirFloatType;
  value: number;
}

export interface KirConstBool {
  kind: "const_bool";
  dest: VarId;
  value: boolean;
}

export interface KirConstString {
  kind: "const_string";
  dest: VarId;
  value: string;
}

export interface KirConstNull {
  kind: "const_null";
  dest: VarId;
  type: KirType;
}

// ── Function calls ───────────────────────────────────────────────────────────

export interface KirCall {
  kind: "call";
  dest: VarId;
  func: string;
  args: VarId[];
  type: KirType;
}

export interface KirCallVoid {
  kind: "call_void";
  func: string;
  args: VarId[];
}

export interface KirCallExtern {
  kind: "call_extern";
  dest: VarId;
  func: string;
  args: VarId[];
  type: KirType;
}

export interface KirCallExternVoid {
  kind: "call_extern_void";
  func: string;
  args: VarId[];
}

// ── Type operations ──────────────────────────────────────────────────────────

export interface KirCast {
  kind: "cast";
  dest: VarId;
  value: VarId;
  targetType: KirType;
}

export interface KirSizeof {
  kind: "sizeof";
  dest: VarId;
  type: KirType;
}

// ── Debug checks ─────────────────────────────────────────────────────────────

export interface KirBoundsCheck {
  kind: "bounds_check";
  index: VarId;
  length: VarId;
}

export interface KirOverflowCheck {
  kind: "overflow_check";
  op: string;
  lhs: VarId;
  rhs: VarId;
}

export interface KirNullCheck {
  kind: "null_check";
  ptr: VarId;
}

export interface KirAssertCheck {
  kind: "assert_check";
  cond: VarId;
  message: string;
}

export interface KirRequireCheck {
  kind: "require_check";
  cond: VarId;
  message: string;
}

// ─── Terminators ─────────────────────────────────────────────────────────────

export type KirTerminator =
  | KirRet
  | KirRetVoid
  | KirJump
  | KirBranch
  | KirSwitch
  | KirUnreachable;

export interface KirRet {
  kind: "ret";
  value: VarId;
}

export interface KirRetVoid {
  kind: "ret_void";
}

export interface KirJump {
  kind: "jump";
  target: BlockId;
}

export interface KirBranch {
  kind: "br";
  cond: VarId;
  thenBlock: BlockId;
  elseBlock: BlockId;
}

export interface KirSwitch {
  kind: "switch";
  value: VarId;
  cases: { value: VarId; target: BlockId }[];
  defaultBlock: BlockId;
}

export interface KirUnreachable {
  kind: "unreachable";
}
