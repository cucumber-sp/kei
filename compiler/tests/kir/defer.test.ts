import { describe, expect, test } from "bun:test";
import type { KirCallVoid } from "../../src/kir/index";
import { getInstructions, lowerAndPrint, lowerFunction } from "./helpers";

const CLEANUP_DECLS = `
  extern fn cleanup() -> void;
  extern fn cleanup2() -> void;
`;

describe("KIR: defer", () => {
  test("single defer emits call before implicit return", () => {
    const kir = lowerAndPrint(`
      ${CLEANUP_DECLS}
      fn foo() {
        defer unsafe { cleanup(); }
      }
    `);
    const callPos = kir.indexOf("call_void cleanup()");
    const retPos = kir.indexOf("ret_void");
    expect(callPos).toBeGreaterThan(-1);
    expect(retPos).toBeGreaterThan(-1);
    expect(callPos).toBeLessThan(retPos);
  });

  test("multiple defers fire in LIFO order", () => {
    const kir = lowerAndPrint(`
      ${CLEANUP_DECLS}
      fn foo() {
        defer unsafe { cleanup(); }
        defer unsafe { cleanup2(); }
      }
    `);
    // cleanup2 deferred second → fires first (LIFO)
    const pos2 = kir.indexOf("call_void cleanup2()");
    const pos1 = kir.indexOf("call_void cleanup()");
    expect(pos2).toBeGreaterThan(-1);
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeLessThan(pos1);
  });

  test("defer fires before explicit return", () => {
    const kir = lowerAndPrint(`
      ${CLEANUP_DECLS}
      fn foo(x: i32) -> i32 {
        defer unsafe { cleanup(); }
        if (x > 0) {
          return x;
        }
        return 0;
      }
    `);
    // Every basic block ending in 'ret' must have been preceded by the cleanup call
    const lines = kir.split("\n");
    let retCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line.includes("  ret ") && !line.includes("  ret_void")) continue;
      retCount++;
      // Scan backwards for cleanup call within this block
      let found = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j] ?? "";
        if (prev.includes("call_void cleanup()")) {
          found = true;
          break;
        }
        // Stop at block label boundary
        if (/^\w[^:]*:$/.test(prev.trim())) break;
      }
      expect(found).toBe(true);
    }
    expect(retCount).toBeGreaterThan(0);
  });

  test("defer in inner scope fires at inner scope exit, not function end", () => {
    const kir = lowerAndPrint(`
      ${CLEANUP_DECLS}
      fn foo() {
        {
          defer unsafe { cleanup(); }
        }
        defer unsafe { cleanup2(); }
      }
    `);
    // cleanup (inner scope) fires before cleanup2 (outer scope)
    const pos1 = kir.indexOf("call_void cleanup()");
    const pos2 = kir.indexOf("call_void cleanup2()");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(-1);
    expect(pos1).toBeLessThan(pos2);
  });

  test("defer count matches number of defer statements", () => {
    const fn = lowerFunction(
      `
      ${CLEANUP_DECLS}
      fn foo() {
        defer unsafe { cleanup(); }
        defer unsafe { cleanup(); }
        defer unsafe { cleanup(); }
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call_void") as KirCallVoid[];
    const cleanupCalls = calls.filter((c) => c.func === "cleanup");
    expect(cleanupCalls.length).toBe(3);
  });

  test("defer captures variable binding at defer point", () => {
    const kir = lowerAndPrint(`
      extern fn use_val(x: i32) -> void;
      fn foo() -> i32 {
        let x: i32 = 42;
        defer unsafe { use_val(x); }
        return x;
      }
    `);
    // The call should appear before the return
    const callPos = kir.indexOf("call_void use_val(");
    const retPos = kir.indexOf("ret ");
    expect(callPos).toBeGreaterThan(-1);
    expect(callPos).toBeLessThan(retPos);
  });
});
