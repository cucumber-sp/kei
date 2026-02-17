import { describe, expect, test } from "bun:test";
import { buildCFG } from "../../src/kir/cfg.ts";
import { buildDomTree, computeDomFrontiers, computeDominators } from "../../src/kir/dominance.ts";
import type { BlockId, KirBlock, KirTerminator } from "../../src/kir/kir-types";

function block(id: BlockId, terminator: KirTerminator): KirBlock {
  return { id, phis: [], instructions: [], terminator };
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

describe("computeDominators", () => {
  test("empty CFG returns empty idom map", () => {
    const cfg = buildCFG([]);
    const idom = computeDominators(cfg);
    expect(idom.size).toBe(0);
  });

  test("single block: entry dominates itself", () => {
    const cfg = buildCFG([block("entry", retVoid())]);
    const idom = computeDominators(cfg);

    expect(idom.get("entry")).toBe("entry");
    expect(idom.size).toBe(1);
  });

  test("linear chain: each block dominated by predecessor", () => {
    const cfg = buildCFG([
      block("entry", jump("b1")),
      block("b1", jump("b2")),
      block("b2", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("entry")).toBe("entry");
    expect(idom.get("b1")).toBe("entry");
    expect(idom.get("b2")).toBe("b1");
  });

  test("diamond pattern: merge idom is entry", () => {
    const cfg = buildCFG([
      block("entry", br("%c", "then", "else")),
      block("then", jump("merge")),
      block("else", jump("merge")),
      block("merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("entry")).toBe("entry");
    expect(idom.get("then")).toBe("entry");
    expect(idom.get("else")).toBe("entry");
    expect(idom.get("merge")).toBe("entry");
  });

  test("if-then (no else): merge idom is entry", () => {
    const cfg = buildCFG([
      block("entry", br("%c", "then", "merge")),
      block("then", jump("merge")),
      block("merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("then")).toBe("entry");
    expect(idom.get("merge")).toBe("entry");
  });

  test("loop: header dominates body", () => {
    const cfg = buildCFG([
      block("entry", jump("header")),
      block("header", br("%c", "body", "exit")),
      block("body", jump("header")),
      block("exit", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("header")).toBe("entry");
    expect(idom.get("body")).toBe("header");
    expect(idom.get("exit")).toBe("header");
  });

  test("nested diamond: inner merge idom is outer branch", () => {
    // entry -> A -> (A.then | A.else) -> A.merge -> exit
    const cfg = buildCFG([
      block("entry", jump("A")),
      block("A", br("%c1", "A.then", "A.else")),
      block("A.then", jump("A.merge")),
      block("A.else", jump("A.merge")),
      block("A.merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("A")).toBe("entry");
    expect(idom.get("A.then")).toBe("A");
    expect(idom.get("A.else")).toBe("A");
    expect(idom.get("A.merge")).toBe("A");
  });

  test("sequential diamonds", () => {
    // entry -> (t1 | e1) -> m1 -> (t2 | e2) -> m2
    const cfg = buildCFG([
      block("entry", br("%c1", "t1", "e1")),
      block("t1", jump("m1")),
      block("e1", jump("m1")),
      block("m1", br("%c2", "t2", "e2")),
      block("t2", jump("m2")),
      block("e2", jump("m2")),
      block("m2", retVoid()),
    ]);
    const idom = computeDominators(cfg);

    expect(idom.get("m1")).toBe("entry");
    expect(idom.get("t2")).toBe("m1");
    expect(idom.get("e2")).toBe("m1");
    expect(idom.get("m2")).toBe("m1");
  });
});

describe("computeDomFrontiers", () => {
  test("single block has empty dominance frontier", () => {
    const cfg = buildCFG([block("entry", retVoid())]);
    const idom = computeDominators(cfg);
    const df = computeDomFrontiers(cfg, idom);

    expect(df.get("entry")?.size ?? 0).toBe(0);
  });

  test("linear chain has empty dominance frontiers", () => {
    const cfg = buildCFG([
      block("entry", jump("b1")),
      block("b1", jump("b2")),
      block("b2", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const df = computeDomFrontiers(cfg, idom);

    expect(df.get("entry")?.size ?? 0).toBe(0);
    expect(df.get("b1")?.size ?? 0).toBe(0);
    expect(df.get("b2")?.size ?? 0).toBe(0);
  });

  test("diamond pattern: branch targets have merge in DF", () => {
    const cfg = buildCFG([
      block("entry", br("%c", "then", "else")),
      block("then", jump("merge")),
      block("else", jump("merge")),
      block("merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const df = computeDomFrontiers(cfg, idom);

    // then and else have merge in their DF
    expect(df.get("then")?.has("merge")).toBe(true);
    expect(df.get("else")?.has("merge")).toBe(true);
    // entry does not (it dominates merge)
    expect(df.get("entry")?.has("merge") ?? false).toBe(false);
  });

  test("loop: header is in DF of body (back edge)", () => {
    const cfg = buildCFG([
      block("entry", jump("header")),
      block("header", br("%c", "body", "exit")),
      block("body", jump("header")),
      block("exit", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const df = computeDomFrontiers(cfg, idom);

    // body's DF contains header (because body jumps to header, but body doesn't dominate header)
    expect(df.get("body")?.has("header")).toBe(true);
    // entry dominates header (idom(header) = entry), so header is NOT in entry's DF
    expect(df.get("entry")?.has("header") ?? false).toBe(false);
  });

  test("if-then pattern DF", () => {
    // entry -> (then | merge), then -> merge
    const cfg = buildCFG([
      block("entry", br("%c", "then", "merge")),
      block("then", jump("merge")),
      block("merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const df = computeDomFrontiers(cfg, idom);

    // merge has 2 preds (entry, then).
    // then's DF should contain merge
    expect(df.get("then")?.has("merge")).toBe(true);
    // entry dominates merge, so merge is NOT in entry's DF
    // But entry is a predecessor of merge and idom(merge) = entry,
    // so runner = entry, runner === idom.get("merge") immediately, loop doesn't run
    expect(df.get("entry")?.has("merge") ?? false).toBe(false);
  });
});

describe("buildDomTree", () => {
  test("single block has empty children", () => {
    const cfg = buildCFG([block("entry", retVoid())]);
    const idom = computeDominators(cfg);
    const tree = buildDomTree(cfg, idom);

    expect(tree.get("entry")).toEqual([]);
  });

  test("linear chain: each block is child of its predecessor", () => {
    const cfg = buildCFG([
      block("entry", jump("b1")),
      block("b1", jump("b2")),
      block("b2", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const tree = buildDomTree(cfg, idom);

    expect(tree.get("entry")).toEqual(["b1"]);
    expect(tree.get("b1")).toEqual(["b2"]);
    expect(tree.get("b2")).toEqual([]);
  });

  test("diamond: entry has then, else, merge as children", () => {
    const cfg = buildCFG([
      block("entry", br("%c", "then", "else")),
      block("then", jump("merge")),
      block("else", jump("merge")),
      block("merge", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const tree = buildDomTree(cfg, idom);

    const entryChildren = tree.get("entry") ?? [];
    expect(entryChildren).toContain("then");
    expect(entryChildren).toContain("else");
    expect(entryChildren).toContain("merge");
    expect(tree.get("then")).toEqual([]);
    expect(tree.get("else")).toEqual([]);
    expect(tree.get("merge")).toEqual([]);
  });

  test("loop: header has body and exit as children", () => {
    const cfg = buildCFG([
      block("entry", jump("header")),
      block("header", br("%c", "body", "exit")),
      block("body", jump("header")),
      block("exit", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const tree = buildDomTree(cfg, idom);

    expect(tree.get("entry")).toEqual(["header"]);
    const headerChildren = tree.get("header") ?? [];
    expect(headerChildren).toContain("body");
    expect(headerChildren).toContain("exit");
  });

  test("sequential diamonds: correct tree structure", () => {
    const cfg = buildCFG([
      block("entry", br("%c1", "t1", "e1")),
      block("t1", jump("m1")),
      block("e1", jump("m1")),
      block("m1", br("%c2", "t2", "e2")),
      block("t2", jump("m2")),
      block("e2", jump("m2")),
      block("m2", retVoid()),
    ]);
    const idom = computeDominators(cfg);
    const tree = buildDomTree(cfg, idom);

    // entry dominates t1, e1, m1
    const entryChildren = tree.get("entry") ?? [];
    expect(entryChildren).toContain("t1");
    expect(entryChildren).toContain("e1");
    expect(entryChildren).toContain("m1");
    // m1 dominates t2, e2, m2
    const m1Children = tree.get("m1") ?? [];
    expect(m1Children).toContain("t2");
    expect(m1Children).toContain("e2");
    expect(m1Children).toContain("m2");
  });
});
