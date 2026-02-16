/**
 * Scope / symbol table for the Kei type checker.
 * Implements nested lexical scopes with symbol lookup.
 */

import type { FunctionOverload, FunctionSymbol, ScopeSymbol } from "./symbols.ts";
import { SymbolKind } from "./symbols.ts";
import type { FunctionType } from "./types.ts";

export class Scope {
  readonly parent: Scope | null;
  readonly symbols: Map<string, ScopeSymbol>;
  readonly isUnsafe: boolean;
  readonly isLoop: boolean;
  readonly functionContext: FunctionType | null;

  constructor(
    parent: Scope | null = null,
    options: { isUnsafe?: boolean; isLoop?: boolean; functionContext?: FunctionType | null } = {}
  ) {
    this.parent = parent;
    this.symbols = new Map();
    this.isUnsafe = options.isUnsafe ?? parent?.isUnsafe ?? false;
    this.isLoop = options.isLoop ?? false;
    this.functionContext = options.functionContext ?? parent?.functionContext ?? null;
  }

  /** Define a symbol in this scope. Returns false if already defined in THIS scope.
   *  For function symbols, allows overloading: adds to the existing overload set
   *  if the name already maps to a function. Returns false only for exact signature duplicates
   *  or name collisions with non-function symbols. */
  define(symbol: ScopeSymbol): boolean {
    const existing = this.symbols.get(symbol.name);
    if (existing) {
      // Allow function overloading: same name, different param signatures
      if (existing.kind === SymbolKind.Function && symbol.kind === SymbolKind.Function) {
        return this.addOverload(existing, symbol);
      }
      return false;
    }
    this.symbols.set(symbol.name, symbol);
    return true;
  }

  /** Add an overload to an existing function symbol. Returns false if exact signature already exists. */
  private addOverload(existing: FunctionSymbol, newSym: FunctionSymbol): boolean {
    const newOverload = newSym.overloads[0];
    if (!newOverload) return false;

    // Check for duplicate signature (same param count and exact param types)
    for (const overload of existing.overloads) {
      if (this.signaturesMatch(overload.type, newOverload.type)) {
        return false; // Exact same signature — duplicate
      }
    }

    existing.overloads.push(newOverload);
    return true;
  }

  /** Check if two function signatures have the same param types (ignoring return type). */
  private signaturesMatch(a: FunctionType, b: FunctionType): boolean {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) {
      const ap = a.params[i];
      const bp = b.params[i];
      if (!ap || !bp) return false;
      if (!this.typesEqualForOverload(ap.type, bp.type)) return false;
    }
    return true;
  }

  /** Structural type equality check for overload resolution. */
  private typesEqualForOverload(a: import("./types.ts").Type, b: import("./types.ts").Type): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case "int":
        return a.bits === (b as any).bits && a.signed === (b as any).signed;
      case "float":
        return a.bits === (b as any).bits;
      case "bool": case "void": case "string": case "null": case "error": case "c_char":
        return true;
      case "struct":
        return a.name === (b as any).name;
      case "enum":
        return a.name === (b as any).name;
      case "type_param":
        return a.name === (b as any).name;
      default:
        return a.kind === b.kind;
    }
  }

  /** Look up a symbol by name, searching up through parent scopes. */
  lookup(name: string): ScopeSymbol | undefined {
    const local = this.symbols.get(name);
    if (local) return local;
    return this.parent?.lookup(name);
  }

  /** Look up only in this scope (no parent traversal). */
  lookupLocal(name: string): ScopeSymbol | undefined {
    return this.symbols.get(name);
  }

  /** Check if we're inside a loop (traverses parent scopes). */
  isInsideLoop(): boolean {
    if (this.isLoop) return true;
    return this.parent?.isInsideLoop() ?? false;
  }

  /** Check if we're inside an unsafe block (traverses parent scopes). */
  isInsideUnsafe(): boolean {
    return this.isUnsafe;
  }

  /** Get the enclosing function context (traverses parent scopes). */
  getEnclosingFunction(): FunctionType | null {
    return this.functionContext;
  }

  /** Look up a variable symbol by name. */
  lookupVariable(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Variable) return sym;
    return undefined;
  }

  /** Look up a function symbol by name. */
  lookupFunction(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Function) return sym;
    return undefined;
  }

  /** Look up a type symbol by name. */
  lookupType(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Type) return sym;
    return undefined;
  }
}
