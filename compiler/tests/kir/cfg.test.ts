import { describe, expect, test } from "bun:test";
import { buildCFG } from "../../src/kir/cfg.ts";
import type { KirBlock, KirTerminator, BlockId } from "../../src/kir/kir-types";

function block(id: BlockId, terminator: KirTerminator): KirBlock {
  return { id, phis: [], instructions: [], terminator };
}

function ret(): KirTerminator {
  return { kind: "ret", value: "%0" };
}

function retVoid(): KirTerminator {
  return { kind: "ret_void" };
}

function jump(target: BlockId): KirTerminator {
  return { kind: "jump", target };
}

function br(cond: string, thenBlock: BlockId, elseBlock: BlockId): KirTerminator {
  return { kind: "br", cond, thenBlock, elseBlock };
}

function switchTerm(
  value: string,
  cases: { value: string; target: BlockId }[],
  defaultBlock: BlockId
): KirTerminator {
  return { kind: "switch", value, cases, defaultBlock };
}

function unreachable(): KirTerminator {
  return { kind: "unreachable" };
}

describe("buildCFG", () => {
  test("empty blocks array returns empty CFG", () => {
    const cfg = buildCFG([]);
    expect(cfg.blockOrder).toEqual([]);
    expect(cfg.preds.size).toBe(0);
    expect(cfg.succs.size).toBe(0);
    expect(cfg.blockMap.size).toBe(0);
  });

  test("single block with ret_void", () => {
    const cfg = buildCFG([block("entry", retVoid())]);

    expect(cfg.blockOrder).toEqual(["entry"]);
    expect(cfg.succs.get("entry")).toEqual([]);
    expect(cfg.preds.get("entry")).toEqual([]);
    expect(cfg.blockMap.get("entry")).toBeDefined();
  });

  test("single block with ret", () => {
    const cfg = buildCFG([block("entry", ret())]);

    expect(cfg.blockOrder).toEqual(["entry"]);
    expect(cfg.succs.get("entry")).toEqual([]);
  });

  test("linear chain: entry -> b1 -> b2 -> exit", () => {
    const blocks = [
      block("entry", jump("b1")),
      block("b1", jump("b2")),
      block("b2", jump("exit")),
      block("exit", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    // Successors
    expect(cfg.succs.get("entry")).toEqual(["b1"]);
    expect(cfg.succs.get("b1")).toEqual(["b2"]);
    expect(cfg.succs.get("b2")).toEqual(["exit"]);
    expect(cfg.succs.get("exit")).toEqual([]);

    // Predecessors
    expect(cfg.preds.get("entry")).toEqual([]);
    expect(cfg.preds.get("b1")).toEqual(["entry"]);
    expect(cfg.preds.get("b2")).toEqual(["b1"]);
    expect(cfg.preds.get("exit")).toEqual(["b2"]);

    // RPO should have all blocks
    expect(cfg.blockOrder).toHaveLength(4);
    // In RPO, entry comes first
    expect(cfg.blockOrder[0]).toBe("entry");
  });

  test("diamond pattern: branch then merge", () => {
    const blocks = [
      block("entry", br("%cond", "then", "else")),
      block("then", jump("merge")),
      block("else", jump("merge")),
      block("merge", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    // entry has two successors
    expect(cfg.succs.get("entry")).toEqual(["then", "else"]);
    // merge has two predecessors
    expect(cfg.preds.get("merge")).toContain("then");
    expect(cfg.preds.get("merge")).toContain("else");
    expect(cfg.preds.get("merge")).toHaveLength(2);

    // RPO: entry first, merge last (after both branches)
    expect(cfg.blockOrder[0]).toBe("entry");
    expect(cfg.blockOrder[cfg.blockOrder.length - 1]).toBe("merge");
    expect(cfg.blockOrder).toHaveLength(4);
  });

  test("switch terminator creates multiple successors", () => {
    const blocks = [
      block("entry", switchTerm("%v", [
        { value: "%c1", target: "case1" },
        { value: "%c2", target: "case2" },
      ], "default")),
      block("case1", retVoid()),
      block("case2", retVoid()),
      block("default", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    expect(cfg.succs.get("entry")).toEqual(["case1", "case2", "default"]);
    expect(cfg.preds.get("case1")).toEqual(["entry"]);
    expect(cfg.preds.get("case2")).toEqual(["entry"]);
    expect(cfg.preds.get("default")).toEqual(["entry"]);
  });

  test("unreachable blocks excluded from blockOrder", () => {
    const blocks = [
      block("entry", retVoid()),
      block("dead", retVoid()), // no edges point here
    ];
    const cfg = buildCFG(blocks);

    expect(cfg.blockOrder).toEqual(["entry"]);
    // But dead block is still in blockMap, preds, succs
    expect(cfg.blockMap.has("dead")).toBe(true);
    expect(cfg.preds.has("dead")).toBe(true);
  });

  test("loop creates back edge: header -> body -> header", () => {
    const blocks = [
      block("entry", jump("header")),
      block("header", br("%cond", "body", "exit")),
      block("body", jump("header")),
      block("exit", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    // header has predecessors: entry and body (back edge)
    expect(cfg.preds.get("header")).toContain("entry");
    expect(cfg.preds.get("header")).toContain("body");
    expect(cfg.preds.get("header")).toHaveLength(2);

    // body's successor is header
    expect(cfg.succs.get("body")).toEqual(["header"]);

    // All blocks reachable
    expect(cfg.blockOrder).toHaveLength(4);
  });

  test("RPO ordering respects dominance (entry always first)", () => {
    const blocks = [
      block("entry", br("%c", "left", "right")),
      block("left", jump("merge")),
      block("right", jump("merge")),
      block("merge", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    const entryIdx = cfg.blockOrder.indexOf("entry");
    const leftIdx = cfg.blockOrder.indexOf("left");
    const rightIdx = cfg.blockOrder.indexOf("right");
    const mergeIdx = cfg.blockOrder.indexOf("merge");

    // Entry comes before everything
    expect(entryIdx).toBe(0);
    // Both branches come before merge
    expect(leftIdx).toBeLessThan(mergeIdx);
    expect(rightIdx).toBeLessThan(mergeIdx);
  });

  test("blockMap contains all blocks", () => {
    const b1 = block("a", jump("b"));
    const b2 = block("b", retVoid());
    const cfg = buildCFG([b1, b2]);

    expect(cfg.blockMap.get("a")).toBe(b1);
    expect(cfg.blockMap.get("b")).toBe(b2);
  });

  test("unreachable terminator has no successors", () => {
    const blocks = [
      block("entry", jump("panic")),
      block("panic", unreachable()),
    ];
    const cfg = buildCFG(blocks);

    expect(cfg.succs.get("panic")).toEqual([]);
  });

  test("multiple predecessors for merge block", () => {
    // Three-way merge
    const blocks = [
      block("entry", switchTerm("%v", [
        { value: "%c1", target: "a" },
        { value: "%c2", target: "b" },
      ], "c")),
      block("a", jump("merge")),
      block("b", jump("merge")),
      block("c", jump("merge")),
      block("merge", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    expect(cfg.preds.get("merge")).toHaveLength(3);
    expect(cfg.preds.get("merge")).toContain("a");
    expect(cfg.preds.get("merge")).toContain("b");
    expect(cfg.preds.get("merge")).toContain("c");
  });

  test("nested loops", () => {
    const blocks = [
      block("entry", jump("outer.header")),
      block("outer.header", br("%c1", "inner.header", "exit")),
      block("inner.header", br("%c2", "inner.body", "outer.latch")),
      block("inner.body", jump("inner.header")),
      block("outer.latch", jump("outer.header")),
      block("exit", retVoid()),
    ];
    const cfg = buildCFG(blocks);

    expect(cfg.blockOrder).toHaveLength(6);
    // Inner header has back edge from inner body
    expect(cfg.preds.get("inner.header")).toContain("inner.body");
    // Outer header has back edge from outer latch
    expect(cfg.preds.get("outer.header")).toContain("outer.latch");
  });
});
