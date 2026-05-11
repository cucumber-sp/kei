/**
 * KIR printer — snapshot coverage for the six Lifecycle marker
 * instructions.
 *
 * Confirms `src/kir/printer.ts` exhaustively handles each `mark_*` kind
 * and that the textual output is stable. Markers are ephemeral
 * (`docs/design/lifecycle-module.md` §3); these snapshots exist to lock
 * down the debug representation for `--kir` dumps and to catch silent
 * drift if anyone touches the printer's switch.
 */

import { describe, expect, test } from "bun:test";
import type { KirBlock, KirFunction, KirInst, KirModule } from "../../src/kir/kir-types";
import { printKir } from "../../src/kir/printer";

const VOID: { kind: "void" } = { kind: "void" };

function modWithInst(inst: KirInst): KirModule {
  const block: KirBlock = {
    id: "entry",
    phis: [],
    instructions: [inst],
    terminator: { kind: "ret_void" },
  };
  const fn: KirFunction = {
    name: "f",
    params: [],
    returnType: VOID,
    blocks: [block],
    localCount: 0,
  };
  return { name: "test", globals: [], functions: [fn], types: [], externs: [] };
}

describe("printKir — lifecycle markers", () => {
  test("mark_scope_enter", () => {
    const out = printKir(modWithInst({ kind: "mark_scope_enter", scopeId: 3 }));
    expect(out).toContain("mark_scope_enter 3");
  });

  test("mark_scope_exit", () => {
    const out = printKir(modWithInst({ kind: "mark_scope_exit", scopeId: 3 }));
    expect(out).toContain("mark_scope_exit 3");
  });

  test("mark_track", () => {
    const out = printKir(modWithInst({ kind: "mark_track", varId: "%x", name: "x", scopeId: 2 }));
    expect(out).toContain("mark_track %x (x), 2");
  });

  test("mark_moved", () => {
    const out = printKir(modWithInst({ kind: "mark_moved", var: "x" }));
    expect(out).toContain("mark_moved x");
  });

  test("mark_assign — copy", () => {
    const out = printKir(
      modWithInst({ kind: "mark_assign", slot: "%s", newValue: "%v", isMove: false })
    );
    expect(out).toContain("mark_assign %s, %v");
    expect(out).not.toContain(", move");
  });

  test("mark_assign — move", () => {
    const out = printKir(
      modWithInst({ kind: "mark_assign", slot: "%s", newValue: "%v", isMove: true })
    );
    expect(out).toContain("mark_assign %s, %v, move");
  });

  test("mark_param", () => {
    const out = printKir(modWithInst({ kind: "mark_param", param: "%p" }));
    expect(out).toContain("mark_param %p");
  });

  test("full block snapshot — marker interleaved with terminator", () => {
    const out = printKir(modWithInst({ kind: "mark_scope_enter", scopeId: 0 }));
    // Locks down indentation + line ordering: marker is indented two
    // spaces (per `printBlock`) and sits before the terminator.
    expect(out).toBe(
      "module test\n\nfn f(): void {\nentry:\n  mark_scope_enter 0\n  ret_void\n}\n"
    );
  });
});
