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

/**
 * Struct type in KIR — laid out as a flat sequence of named fields.
 *
 * `name` is the bare struct name. `modulePrefix` is the defining module's
 * prefix (`"arena"` for `std/arena.kei`; empty for the main module or for
 * generic-monomorphized instances whose name already encodes everything).
 * Lifecycle hook lookups must compose them as `<prefix>_<name>___destroy`
 * so cross-module call sites resolve to the right symbol.
 */
export interface KirStructType {
  kind: "struct";
  name: string;
  modulePrefix?: string;
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
