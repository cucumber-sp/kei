/**
 * Scope / symbol table for the Kei type checker.
 *
 * Implements nested lexical scopes with symbol lookup. Each scope holds a
 * symbol map and a reference to its parent, forming a chain from innermost
 * block up to the global scope. Symbol lookup walks the chain from local
 * to global, so inner definitions naturally shadow outer ones.
 *
 * Context flags (`isUnsafe`, `isLoop`, `functionContext`) are propagated
 * through the scope chain so that any nested scope can query the enclosing
 * context without a linear scan (except `isLoop`, which must scan since
 * a function boundary should *not* inherit a loop context).
 */

import type { FunctionSymbol, ScopeSymbol } from "./symbols.ts";
import { SymbolKind } from "./symbols.ts";
import { typesEqual, type FunctionType } from "./types.ts";

export class Scope {
  /** Parent scope, or `null` for the global scope. */
  readonly parent: Scope | null;

  /** Symbols defined in *this* scope only. */
  readonly symbols: Map<string, ScopeSymbol>;

  /**
   * Whether this scope (and all children) is inside an `unsafe` block.
   * Inherited from parent at construction time — no runtime traversal needed.
   */
  readonly isUnsafe: boolean;

  /**
   * Whether *this specific* scope was created for a loop body.
   * Not inherited: a nested function inside a loop should not count as
   * "inside a loop", so `isInsideLoop()` traverses manually.
   */
  readonly isLoop: boolean;

  /**
   * The enclosing function's type, used for return-type validation.
   * Inherited from parent at construction time.
   */
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

  /**
   * Define a symbol in this scope.
   *
   * Returns `true` on success, `false` if a symbol with the same name
   * already exists in *this* scope. Shadowing outer-scope names is allowed
   * (the outer symbol is simply hidden until this scope ends).
   *
   * **Function overloading:** if both the existing and new symbol are
   * functions, the new overload is added to the existing symbol's overload
   * set. Returns `false` only for exact signature duplicates or name
   * collisions with non-function symbols.
   */
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

  /**
   * Add an overload to an existing function symbol.
   * Returns `false` if an overload with an identical parameter signature
   * already exists (return type is *not* considered for overload resolution).
   */
  private addOverload(existing: FunctionSymbol, newSym: FunctionSymbol): boolean {
    const newOverload = newSym.overloads[0];
    if (!newOverload) return false;

    for (const overload of existing.overloads) {
      if (this.signaturesMatch(overload.type, newOverload.type)) {
        return false;
      }
    }

    existing.overloads.push(newOverload);
    return true;
  }

  /** Check if two function signatures have identical parameter types (ignoring return type). */
  private signaturesMatch(a: FunctionType, b: FunctionType): boolean {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) {
      const ap = a.params[i];
      const bp = b.params[i];
      if (!ap || !bp) return false;
      if (!typesEqual(ap.type, bp.type)) return false;
    }
    return true;
  }

  /**
   * Look up a symbol by name, walking up the scope chain.
   * Returns the *innermost* (most local) binding, implementing shadowing.
   */
  lookup(name: string): ScopeSymbol | undefined {
    const local = this.symbols.get(name);
    if (local) return local;
    return this.parent?.lookup(name);
  }

  /** Look up a symbol in *this* scope only (no parent traversal). */
  lookupLocal(name: string): ScopeSymbol | undefined {
    return this.symbols.get(name);
  }

  /**
   * Check if we're inside a loop body by walking up the scope chain.
   * Stops at function boundaries since loops don't cross them.
   */
  isInsideLoop(): boolean {
    if (this.isLoop) return true;
    return this.parent?.isInsideLoop() ?? false;
  }

  /**
   * Check if we're inside an `unsafe` block.
   * This is O(1) since `isUnsafe` is inherited at construction time.
   */
  isInsideUnsafe(): boolean {
    return this.isUnsafe;
  }

  /**
   * Get the enclosing function's type (for return-type checking).
   * O(1) since `functionContext` is inherited at construction time.
   */
  getEnclosingFunction(): FunctionType | null {
    return this.functionContext;
  }

  /** Look up a variable symbol by name (returns `undefined` for non-variable symbols). */
  lookupVariable(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Variable) return sym;
    return undefined;
  }

  /** Look up a function symbol by name (returns `undefined` for non-function symbols). */
  lookupFunction(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Function) return sym;
    return undefined;
  }

  /** Look up a type symbol by name (returns `undefined` for non-type symbols). */
  lookupType(name: string): ScopeSymbol | undefined {
    const sym = this.lookup(name);
    if (sym && sym.kind === SymbolKind.Type) return sym;
    return undefined;
  }
}
