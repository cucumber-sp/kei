import { describe, expect, test } from "bun:test";
import { getTerminators, lowerFunction } from "./helpers.ts";

describe("KIR: switch statements", () => {
  test("switch generates switch terminator", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) -> int {
        switch x {
          case 1: return 10;
          case 2: return 20;
          default: return 0;
        }
      }
    `,
      "foo"
    );
    const switches = getTerminators(fn, "switch");
    expect(switches.length).toBeGreaterThanOrEqual(1);
  });

  test("switch creates case blocks", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) -> int {
        switch x {
          case 1: return 10;
          case 2: return 20;
          default: return 0;
        }
      }
    `,
      "foo"
    );
    const caseBlocks = fn.blocks.filter((b) => b.id.startsWith("switch.case"));
    expect(caseBlocks.length).toBeGreaterThanOrEqual(2);
  });

  test("switch creates default block", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) -> int {
        switch x {
          case 1: return 10;
          default: return 0;
        }
      }
    `,
      "foo"
    );
    const defaultBlocks = fn.blocks.filter((b) => b.id.startsWith("switch.default"));
    expect(defaultBlocks).toHaveLength(1);
  });

  test("switch with fallthrough to end block", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) {
        switch x {
          case 1: let a: int = 1;
          case 2: let b: int = 2;
          default: let c: int = 3;
        }
      }
    `,
      "foo"
    );
    // Each case without return should jump to switch.end
    const endBlocks = fn.blocks.filter((b) => b.id.startsWith("switch.end"));
    expect(endBlocks).toHaveLength(1);
  });
});
