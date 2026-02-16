/**
 * Symbol definitions for the Kei type checker.
 * Symbols represent named entities in the program: variables, functions, types.
 */

import type { EnumDecl, FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes.ts";
import type { EnumType, FunctionType, ModuleType, StructType, Type } from "./types.ts";

// ─── Symbol Kind Constants ──────────────────────────────────────────────────

export const SymbolKind = {
  Variable: "variable",
  Function: "function",
  Type: "type",
  Module: "module",
} as const;

// ─── Symbol Definitions ─────────────────────────────────────────────────────

export interface VariableSymbol {
  kind: typeof SymbolKind.Variable;
  name: string;
  type: Type;
  isMutable: boolean;
  isConst: boolean;
  isMoved: boolean;
}

export interface FunctionOverload {
  type: FunctionType;
  isExtern: boolean;
  declaration: FunctionDecl | null;
}

export interface FunctionSymbol {
  kind: typeof SymbolKind.Function;
  name: string;
  type: FunctionType;
  isExtern: boolean;
  declaration: FunctionDecl | null;
  overloads: FunctionOverload[];
}

export interface TypeSymbol {
  kind: typeof SymbolKind.Type;
  name: string;
  type: Type;
  declaration: StructDecl | UnsafeStructDecl | EnumDecl | null;
}

export interface ModuleSymbol {
  kind: typeof SymbolKind.Module;
  name: string;
  type: ModuleType;
  /** All public symbols from this module, keyed by name */
  symbols: Map<string, ScopeSymbol>;
}

export type ScopeSymbol = VariableSymbol | FunctionSymbol | TypeSymbol | ModuleSymbol;

// ─── Symbol Constructors ────────────────────────────────────────────────────

export function variableSymbol(
  name: string,
  type: Type,
  isMutable: boolean,
  isConst: boolean
): VariableSymbol {
  return { kind: SymbolKind.Variable, name, type, isMutable, isConst, isMoved: false };
}

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

export function typeSymbol(
  name: string,
  type: StructType | EnumType | Type,
  declaration: StructDecl | UnsafeStructDecl | EnumDecl | null = null
): TypeSymbol {
  return { kind: SymbolKind.Type, name, type, declaration };
}

export function moduleSymbol(
  name: string,
  moduleType: ModuleType,
  symbols: Map<string, ScopeSymbol>
): ModuleSymbol {
  return { kind: SymbolKind.Module, name, type: moduleType, symbols };
}
