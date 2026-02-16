/**
 * Scope / symbol table for the Kei type checker.
 * Implements nested lexical scopes with symbol lookup.
 */

import type { ScopeSymbol } from "./symbols.ts";
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

  /** Define a symbol in this scope. Returns false if already defined in THIS scope. */
  define(symbol: ScopeSymbol): boolean {
    if (this.symbols.has(symbol.name)) {
      return false;
    }
    this.symbols.set(symbol.name, symbol);
    return true;
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
