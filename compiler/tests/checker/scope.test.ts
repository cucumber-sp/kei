import { describe, expect, test } from "bun:test";
import { Scope } from "../../src/checker/scope.ts";
import { functionSymbol, typeSymbol, variableSymbol } from "../../src/checker/symbols.ts";
import { SymbolKind } from "../../src/checker/symbols.ts";
import {
  BOOL_TYPE,
  I32_TYPE,
  I64_TYPE,
  F64_TYPE,
  STRING_TYPE,
  VOID_TYPE,
  functionType,
} from "../../src/checker/types";
import type { FunctionType } from "../../src/checker/types";

function makeFnType(paramTypes: import("../../src/checker/types").Type[], ret: import("../../src/checker/types").Type): FunctionType {
  return functionType(
    paramTypes.map((t, i) => ({ name: `p${i}`, type: t, isMut: false, isMove: false })),
    ret
  );
}

describe("Scope", () => {
  describe("constructor defaults", () => {
    test("global scope has null parent and default flags", () => {
      const scope = new Scope();
      expect(scope.parent).toBeNull();
      expect(scope.isUnsafe).toBe(false);
      expect(scope.isLoop).toBe(false);
      expect(scope.functionContext).toBeNull();
    });

    test("child scope inherits parent reference", () => {
      const parent = new Scope();
      const child = new Scope(parent);
      expect(child.parent).toBe(parent);
    });
  });

  describe("define and lookup", () => {
    test("defines and looks up a variable", () => {
      const scope = new Scope();
      const sym = variableSymbol("x", I32_TYPE, true, false);
      expect(scope.define(sym)).toBe(true);
      expect(scope.lookup("x")).toBe(sym);
    });

    test("returns undefined for missing symbol", () => {
      const scope = new Scope();
      expect(scope.lookup("missing")).toBeUndefined();
    });

    test("rejects duplicate non-function symbol", () => {
      const scope = new Scope();
      scope.define(variableSymbol("x", I32_TYPE, true, false));
      expect(scope.define(variableSymbol("x", BOOL_TYPE, false, false))).toBe(false);
    });

    test("rejects variable/function name collision", () => {
      const scope = new Scope();
      scope.define(variableSymbol("foo", I32_TYPE, false, false));
      expect(scope.define(functionSymbol("foo", makeFnType([], VOID_TYPE), false))).toBe(false);
    });
  });

  describe("scope chaining and shadowing", () => {
    test("child scope finds symbol in parent", () => {
      const parent = new Scope();
      parent.define(variableSymbol("x", I32_TYPE, false, false));
      const child = new Scope(parent);
      expect(child.lookup("x")?.name).toBe("x");
    });

    test("child scope shadows parent symbol", () => {
      const parent = new Scope();
      parent.define(variableSymbol("x", I32_TYPE, false, false));
      const child = new Scope(parent);
      const childSym = variableSymbol("x", BOOL_TYPE, true, false);
      child.define(childSym);
      expect(child.lookup("x")).toBe(childSym);
    });

    test("parent scope is unaffected by child definition", () => {
      const parent = new Scope();
      parent.define(variableSymbol("x", I32_TYPE, false, false));
      const child = new Scope(parent);
      child.define(variableSymbol("x", BOOL_TYPE, true, false));
      expect(parent.lookup("x")?.type).toEqual(I32_TYPE);
    });

    test("deeply nested scope walks full chain", () => {
      const global = new Scope();
      global.define(variableSymbol("g", I32_TYPE, false, false));
      const fn = new Scope(global);
      const block = new Scope(fn);
      const inner = new Scope(block);
      expect(inner.lookup("g")?.name).toBe("g");
    });
  });

  describe("lookupLocal", () => {
    test("finds symbol in this scope only", () => {
      const parent = new Scope();
      parent.define(variableSymbol("x", I32_TYPE, false, false));
      const child = new Scope(parent);
      expect(child.lookupLocal("x")).toBeUndefined();
    });

    test("finds locally defined symbol", () => {
      const scope = new Scope();
      const sym = variableSymbol("x", I32_TYPE, false, false);
      scope.define(sym);
      expect(scope.lookupLocal("x")).toBe(sym);
    });
  });

  describe("function overloading", () => {
    test("allows overloads with different parameter types", () => {
      const scope = new Scope();
      const fn1 = functionSymbol("add", makeFnType([I32_TYPE, I32_TYPE], I32_TYPE), false);
      const fn2 = functionSymbol("add", makeFnType([F64_TYPE, F64_TYPE], F64_TYPE), false);
      expect(scope.define(fn1)).toBe(true);
      expect(scope.define(fn2)).toBe(true);
      // The existing symbol should have 2 overloads
      const sym = scope.lookup("add");
      expect(sym?.kind).toBe(SymbolKind.Function);
      if (sym?.kind === SymbolKind.Function) {
        expect(sym.overloads).toHaveLength(2);
      }
    });

    test("rejects overloads with identical parameter types", () => {
      const scope = new Scope();
      const fn1 = functionSymbol("process", makeFnType([I32_TYPE], VOID_TYPE), false);
      const fn2 = functionSymbol("process", makeFnType([I32_TYPE], I32_TYPE), false); // same params, different return
      expect(scope.define(fn1)).toBe(true);
      expect(scope.define(fn2)).toBe(false);
    });

    test("allows overloads with different arity", () => {
      const scope = new Scope();
      const fn1 = functionSymbol("f", makeFnType([], VOID_TYPE), false);
      const fn2 = functionSymbol("f", makeFnType([I32_TYPE], VOID_TYPE), false);
      expect(scope.define(fn1)).toBe(true);
      expect(scope.define(fn2)).toBe(true);
      const sym = scope.lookup("f");
      if (sym?.kind === SymbolKind.Function) {
        expect(sym.overloads).toHaveLength(2);
      }
    });
  });

  describe("isInsideLoop", () => {
    test("returns false for non-loop scope", () => {
      const scope = new Scope();
      expect(scope.isInsideLoop()).toBe(false);
    });

    test("returns true for loop scope", () => {
      const scope = new Scope(null, { isLoop: true });
      expect(scope.isInsideLoop()).toBe(true);
    });

    test("returns true for child of loop scope", () => {
      const loopScope = new Scope(null, { isLoop: true });
      const inner = new Scope(loopScope);
      expect(inner.isInsideLoop()).toBe(true);
    });

    test("isLoop is not inherited at construction — only isInsideLoop() traverses", () => {
      const loopScope = new Scope(null, { isLoop: true });
      const child = new Scope(loopScope);
      // child.isLoop is false (not inherited)
      expect(child.isLoop).toBe(false);
      // but isInsideLoop walks up and finds the parent
      expect(child.isInsideLoop()).toBe(true);
    });
  });

  describe("isInsideUnsafe", () => {
    test("returns false by default", () => {
      const scope = new Scope();
      expect(scope.isInsideUnsafe()).toBe(false);
    });

    test("returns true for unsafe scope", () => {
      const scope = new Scope(null, { isUnsafe: true });
      expect(scope.isInsideUnsafe()).toBe(true);
    });

    test("child inherits unsafe from parent", () => {
      const unsafe = new Scope(null, { isUnsafe: true });
      const child = new Scope(unsafe);
      expect(child.isInsideUnsafe()).toBe(true);
      expect(child.isUnsafe).toBe(true);
    });

    test("child can be unsafe even if parent is not", () => {
      const safe = new Scope();
      const unsafeChild = new Scope(safe, { isUnsafe: true });
      expect(unsafeChild.isInsideUnsafe()).toBe(true);
    });
  });

  describe("getEnclosingFunction", () => {
    test("returns null when no function context", () => {
      const scope = new Scope();
      expect(scope.getEnclosingFunction()).toBeNull();
    });

    test("returns function context when set", () => {
      const fnType = makeFnType([I32_TYPE], I32_TYPE);
      const scope = new Scope(null, { functionContext: fnType });
      expect(scope.getEnclosingFunction()).toBe(fnType);
    });

    test("child inherits function context from parent", () => {
      const fnType = makeFnType([], VOID_TYPE);
      const fnScope = new Scope(null, { functionContext: fnType });
      const block = new Scope(fnScope);
      expect(block.getEnclosingFunction()).toBe(fnType);
    });
  });

  describe("filtered lookups", () => {
    test("lookupVariable returns only variables", () => {
      const scope = new Scope();
      scope.define(functionSymbol("foo", makeFnType([], VOID_TYPE), false));
      scope.define(variableSymbol("bar", I32_TYPE, true, false));

      expect(scope.lookupVariable("foo")).toBeUndefined();
      expect(scope.lookupVariable("bar")?.name).toBe("bar");
    });

    test("lookupFunction returns only functions", () => {
      const scope = new Scope();
      scope.define(variableSymbol("x", I32_TYPE, true, false));
      scope.define(functionSymbol("f", makeFnType([], VOID_TYPE), false));

      expect(scope.lookupFunction("x")).toBeUndefined();
      expect(scope.lookupFunction("f")?.name).toBe("f");
    });

    test("lookupType returns only types", () => {
      const scope = new Scope();
      scope.define(variableSymbol("x", I32_TYPE, true, false));
      scope.define(typeSymbol("MyType", I32_TYPE));

      expect(scope.lookupType("x")).toBeUndefined();
      expect(scope.lookupType("MyType")?.name).toBe("MyType");
    });

    test("filtered lookups walk the scope chain", () => {
      const parent = new Scope();
      parent.define(typeSymbol("ParentType", BOOL_TYPE));
      const child = new Scope(parent);

      expect(child.lookupType("ParentType")?.name).toBe("ParentType");
    });
  });
});
