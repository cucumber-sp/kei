import { describe, expect, test } from "bun:test";
import { getTerminators, lowerFunction } from "./helpers.ts";

describe("KIR: if/else", () => {
  test("if creates branch terminator", () => {
    const fn = lowerFunction(
      `
      fn foo(x: bool) -> int {
        if x {
          return 1;
        }
        return 0;
      }
    `,
      "foo"
    );
    const branches = getTerminators(fn, "br");
    expect(branches.length).toBeGreaterThanOrEqual(1);
  });

  test("if/else creates two branch blocks", () => {
    const fn = lowerFunction(
      `
      fn foo(x: bool) -> int {
        if x {
          return 1;
        } else {
          return 0;
        }
      }
    `,
      "foo"
    );
    const branches = getTerminators(fn, "br");
    expect(branches.length).toBeGreaterThanOrEqual(1);
    // Should have then and else blocks
    const thenBlock = fn.blocks.find((b) => b.id.startsWith("if.then"));
    const elseBlock = fn.blocks.find((b) => b.id.startsWith("if.else"));
    expect(thenBlock).toBeDefined();
    expect(elseBlock).toBeDefined();
  });

  test("if/else with merge block", () => {
    const fn = lowerFunction(
      `
      fn foo(x: bool) {
        if x {
          let a: int = 1;
        } else {
          let b: int = 2;
        }
      }
    `,
      "foo"
    );
    // Should have entry, then, else, and end blocks
    expect(fn.blocks.length).toBeGreaterThanOrEqual(4);
    const endBlock = fn.blocks.find((b) => b.id.startsWith("if.end"));
    expect(endBlock).toBeDefined();
  });

  test("nested if/else", () => {
    const fn = lowerFunction(
      `
      fn foo(a: bool, b: bool) -> int {
        if a {
          if b {
            return 1;
          } else {
            return 2;
          }
        } else {
          return 3;
        }
      }
    `,
      "foo"
    );
    // Should have multiple branch levels
    const branches = getTerminators(fn, "br");
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });

  test("else-if chain", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) -> int {
        if x == 1 {
          return 10;
        } else if x == 2 {
          return 20;
        } else {
          return 30;
        }
      }
    `,
      "foo"
    );
    const branches = getTerminators(fn, "br");
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("KIR: while loops", () => {
  test("while loop creates header and body blocks", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
      }
    `,
      "foo"
    );
    const headerBlock = fn.blocks.find((b) => b.id.startsWith("while.header"));
    const bodyBlock = fn.blocks.find((b) => b.id.startsWith("while.body"));
    expect(headerBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
  });

  test("while loop has conditional branch in header", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
      }
    `,
      "foo"
    );
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees block exists
    const headerBlock = fn.blocks.find((b) => b.id.startsWith("while.header"))!;
    expect(headerBlock.terminator.kind).toBe("br");
  });

  test("while body jumps back to header", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
      }
    `,
      "foo"
    );
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees block exists
    const bodyBlock = fn.blocks.find((b) => b.id.startsWith("while.body"))!;
    expect(bodyBlock.terminator.kind).toBe("jump");
    if (bodyBlock.terminator.kind === "jump") {
      expect(bodyBlock.terminator.target).toMatch(/^while\.header/);
    }
  });

  test("while loop has end block", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
      }
    `,
      "foo"
    );
    const endBlock = fn.blocks.find((b) => b.id.startsWith("while.end"));
    expect(endBlock).toBeDefined();
  });

  test("break in while loop jumps to end", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while true {
          if x == 5 {
            break;
          }
          x = x + 1;
        }
      }
    `,
      "foo"
    );
    // Should have a jump to while.end somewhere
    const jumps = getTerminators(fn, "jump");
    const jumpToEnd = jumps.some((j) => j.kind === "jump" && j.target.startsWith("while.end"));
    expect(jumpToEnd).toBe(true);
  });

  test("continue in while loop jumps to header", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
          if x == 5 {
            continue;
          }
        }
      }
    `,
      "foo"
    );
    const jumps = getTerminators(fn, "jump");
    const jumpToHeader = jumps.some(
      (j) => j.kind === "jump" && j.target.startsWith("while.header")
    );
    expect(jumpToHeader).toBe(true);
  });
});

describe("KIR: for loops", () => {
  test("for range loop creates init/header/body/latch blocks", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        for (let i = 0; i < 10; i = i + 1) {
          let x: int = i;
        }
      }
    `,
      "foo"
    );
    const headerBlock = fn.blocks.find((b) => b.id.startsWith("cfor.header"));
    const bodyBlock = fn.blocks.find((b) => b.id.startsWith("cfor.body"));
    const latchBlock = fn.blocks.find((b) => b.id.startsWith("cfor.latch"));
    expect(headerBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
    expect(latchBlock).toBeDefined();
  });

  test("for range loop has conditional branch in header", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        for (let i = 0; i < 10; i = i + 1) {
          let x: int = i;
        }
      }
    `,
      "foo"
    );
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees block exists
    const headerBlock = fn.blocks.find((b) => b.id.startsWith("cfor.header"))!;
    expect(headerBlock.terminator.kind).toBe("br");
  });

  test("for loop latch increments and jumps to header", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        for (let i = 0; i < 5; i = i + 1) {
          let x: int = i;
        }
      }
    `,
      "foo"
    );
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees block exists
    const latchBlock = fn.blocks.find((b) => b.id.startsWith("cfor.latch"))!;
    expect(latchBlock.terminator.kind).toBe("jump");
    if (latchBlock.terminator.kind === "jump") {
      expect(latchBlock.terminator.target).toMatch(/^cfor\.header/);
    }
  });
});
