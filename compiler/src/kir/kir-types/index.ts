/**
 * KIR (Kei Intermediate Representation) node types.
 * Uses discriminated unions with a `kind` field, matching AST conventions.
 *
 * KIR is a low-level SSA-based IR that sits between the type-checked AST
 * and the C backend. It uses basic blocks with explicit terminators and
 * phi nodes for value merging at control-flow join points.
 */

export * from "./identifiers";
export * from "./types";
export * from "./module";
export * from "./function";
export * from "./instructions";
export * from "./terminators";
