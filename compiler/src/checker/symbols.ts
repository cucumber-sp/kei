/**
 * Symbol definitions for the Kei type checker.
 *
 * Symbols represent named entities in the program: variables, functions,
 * types (structs/enums/aliases), and imported modules. Each symbol carries
 * its kind, name, resolved type, and — where applicable — a reference back
 * to the originating AST node.
 */

import type { EnumDecl, FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes.ts";
import type { EnumType, FunctionType, ModuleType, StructType, Type } from "./types";

// ─── Symbol Kind Constants ──────────────────────────────────────────────────

/** Discriminant tags for the `ScopeSymbol` union. */
export const SymbolKind = {
  Variable: "variable",
  Function: "function",
  Type: "type",
  Module: "module",
} as const;

// ─── Symbol Definitions ─────────────────────────────────────────────────────

/** A local or global variable (including `let`, `const`, `static`, and function params). */
export interface VariableSymbol {
  kind: typeof SymbolKind.Variable;
  name: string;
  type: Type;
  isMutable: boolean;
  isConst: boolean;
  /** Set to `true` once the variable has been consumed by a move. */
  isMoved: boolean;
}

/** A single overload of a function — its resolved type, extern flag, and AST node. */
export interface FunctionOverload {
  type: FunctionType;
  isExtern: boolean;
  declaration: FunctionDecl | null;
}

/**
 * A function or function-overload set.
 * `type` is the primary overload's type; `overloads` holds all signatures
 * (including the primary) for overload resolution.
 */
export interface FunctionSymbol {
  kind: typeof SymbolKind.Function;
  name: string;
  type: FunctionType;
  isExtern: boolean;
  declaration: FunctionDecl | null;
  overloads: FunctionOverload[];
}

/** A named type: struct, enum, type alias, or generic type parameter. */
export interface TypeSymbol {
  kind: typeof SymbolKind.Type;
  name: string;
  type: Type;
  declaration: StructDecl | UnsafeStructDecl | EnumDecl | null;
}

/** An imported module, providing qualified access to its exported symbols. */
export interface ModuleSymbol {
  kind: typeof SymbolKind.Module;
  name: string;
  type: ModuleType;
  /** All public symbols from this module, keyed by name. */
  symbols: Map<string, ScopeSymbol>;
}

/** Union of all symbol kinds that can appear in a `Scope`. */
export type ScopeSymbol = VariableSymbol | FunctionSymbol | TypeSymbol | ModuleSymbol;

// ─── Symbol Constructors ────────────────────────────────────────────────────

/** Create a variable symbol (local, parameter, or static). */
export function variableSymbol(
  name: string,
  type: Type,
  isMutable: boolean,
  isConst: boolean
): VariableSymbol {
  return { kind: SymbolKind.Variable, name, type, isMutable, isConst, isMoved: false };
}

/**
 * Create a function symbol with a single initial overload.
 * Additional overloads are added via `Scope.define()` when a second
 * function with the same name but different signature is registered.
 */
export function functionSymbol(
  name: string,
  type: FunctionType,
  isExtern: boolean,
  declaration: FunctionDecl | null = null
): FunctionSymbol {
  return {
    kind: SymbolKind.Function,
    name,
    type,
    isExtern,
    declaration,
    overloads: [{ type, isExtern, declaration }],
  };
}

/** Create a type symbol (struct, enum, alias, or generic type parameter). */
export function typeSymbol(
  name: string,
  type: StructType | EnumType | Type,
  declaration: StructDecl | UnsafeStructDecl | EnumDecl | null = null
): TypeSymbol {
  return { kind: SymbolKind.Type, name, type, declaration };
}

/** Create a module symbol for qualified access (`module.name`). */
export function moduleSymbol(
  name: string,
  moduleType: ModuleType,
  symbols: Map<string, ScopeSymbol>
): ModuleSymbol {
  return { kind: SymbolKind.Module, name, type: moduleType, symbols };
}
