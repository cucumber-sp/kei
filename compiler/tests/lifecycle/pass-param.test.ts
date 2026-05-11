/**
 * Lifecycle pass — `mark_param` rewrite (PR 4c).
 *
 * Per `docs/design/lifecycle-module.md` §9, these tests exercise the
 * `mark_param` → per-exit-destroy rewrite on synthetic KIR (no parser,
 * no checker, no lowering driver). Cases:
 *
 *   1. function with one managed-struct param and two `return` paths →
 *      destroy fires before both terminators
 *   2. function with managed-struct param using the throws protocol →
 *      destroy fires at the success-tag return and the error-tag return
 *   3. function with a mix of managed and non-managed params → only the
 *      managed params get destroys
 *   4. function with no managed params → no destroys inserted
 *   5. `mark_param` is always stripped, even when the block does not end
 *      in an exit terminator (only `ret`/`ret_void` trigger emission;
 *      `jump`/`br` blocks pass through unchanged save for the strip)
 */

import { describe, expect, test } from "bun:test";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirModule,
  KirParam,
  KirTerminator,
} from "../../src/kir/kir-types";
import { runLifecyclePass } from "../../src/lifecycle";

/** A `getDecision` that always says "no decision". The pass doesn't consult it for `mark_param`. */
const noDecisions = () => undefined;

const I32: { kind: "int"; bits: 32; signed: true } = { kind: "int", bits: 32, signed: true };

/** Build a struct-typed param: KIR lowers managed structs to `ptr → struct`. */
function structParam(name: string, structName: string): KirParam {
  return {
    name,
    type: { kind: "ptr", pointee: { kind: "struct", name: structName, fields: [] } },
  };
}

/** Build a non-managed param (e.g. an i32 value). */
function intParam(name: string): KirParam {
  return { name, type: I32 };
}

function block(
  id: string,
  instructions: KirInst[],
  terminator: KirTerminator = { kind: "ret_void" }
): KirBlock {
  return { id, phis: [], instructions, terminator };
}

function fn(name: string, params: KirParam[], blocks: KirBlock[]): KirFunction {
  return {
    name,
    params,
    returnType: { kind: "void" },
    blocks,
    localCount: 0,
  };
}

function moduleWith(...fns: KirFunction[]): KirModule {
  return { name: "test", globals: [], functions: fns, types: [], externs: [] };
}

/** Collect instruction kinds per block, flattened. Useful for "no destroy emitted" assertions. */
function instKindsByBlock(fn: KirFunction): string[][] {
  return fn.blocks.map((b) => b.instructions.map((i) => i.kind));
}

describe("runLifecyclePass — mark_param rewrite (PR 4c)", () => {
  test("one managed param, two `return` paths → destroy at both", () => {
    // Synthetic shape of a function that branches and has a `ret` in each arm.
    //
    //   entry:
    //     mark_param %p
    //     br cond, then, else
    //   then:
    //     ret 1
    //   else:
    //     ret 2
    const before = moduleWith(
      fn(
        "f",
        [structParam("p", "Bag")],
        [
          block("entry", [{ kind: "mark_param", param: "%p" }], {
            kind: "br",
            cond: "%c",
            thenBlock: "then",
            elseBlock: "else",
          }),
          block("then", [], { kind: "ret", value: "%v1" }),
          block("else", [], { kind: "ret", value: "%v2" }),
        ]
      )
    );

    const after = runLifecyclePass(before, noDecisions);
    const f = after.functions[0];
    expect(f).toBeDefined();
    const blocks = instKindsByBlock(f as KirFunction);
    // entry's mark_param stripped; `br` does not trigger destroy emission.
    expect(blocks[0]).toEqual([]);
    // Both ret-terminated blocks get the param destroy appended.
    expect(blocks[1]).toEqual(["destroy"]);
    expect(blocks[2]).toEqual(["destroy"]);

    const thenDestroy = (f as KirFunction).blocks[1]?.instructions[0];
    expect(thenDestroy).toEqual({ kind: "destroy", value: "%p", structName: "Bag" });
    const elseDestroy = (f as KirFunction).blocks[2]?.instructions[0];
    expect(elseDestroy).toEqual({ kind: "destroy", value: "%p", structName: "Bag" });
  });

  test("throws protocol — destroy fires at success-tag ret and error-tag ret", () => {
    // Throws functions return an i32 tag at every exit (0 = success, 1+ = err).
    // Both arms terminate in `ret <tag>`; both must destroy the managed param.
    const before = moduleWith(
      fn(
        "g",
        [structParam("p", "Doc")],
        [
          block("entry", [{ kind: "mark_param", param: "%p" }], {
            kind: "br",
            cond: "%cond",
            thenBlock: "ok",
            elseBlock: "err",
          }),
          block("ok", [], { kind: "ret", value: "%zeroTag" }),
          block("err", [], { kind: "ret", value: "%errTag" }),
        ]
      )
    );

    const after = runLifecyclePass(before, noDecisions);
    const blocks = (after.functions[0] as KirFunction).blocks;
    expect(blocks[0]?.instructions).toEqual([]);
    expect(blocks[1]?.instructions).toEqual([{ kind: "destroy", value: "%p", structName: "Doc" }]);
    expect(blocks[2]?.instructions).toEqual([{ kind: "destroy", value: "%p", structName: "Doc" }]);
  });

  test("mixed managed + non-managed params → only managed get destroys", () => {
    // `mark_param` is only emitted by lowering for managed structs; the
    // non-managed param has no marker. The pass reads markers, not
    // params, so this is naturally a function of *what was emitted*.
    const before = moduleWith(
      fn(
        "h",
        [structParam("a", "Bag"), intParam("n"), structParam("b", "Doc")],
        [
          block(
            "entry",
            [
              { kind: "mark_param", param: "%a" },
              { kind: "mark_param", param: "%b" },
            ],
            { kind: "ret_void" }
          ),
        ]
      )
    );

    const after = runLifecyclePass(before, noDecisions);
    const insts = (after.functions[0] as KirFunction).blocks[0]?.instructions;
    expect(insts).toEqual([
      { kind: "destroy", value: "%a", structName: "Bag" },
      { kind: "destroy", value: "%b", structName: "Doc" },
    ]);
  });

  test("no managed params → no destroys inserted, terminator preserved", () => {
    const before = moduleWith(
      fn(
        "k",
        [intParam("n")],
        [
          block("entry", [{ kind: "const_int", dest: "%0", type: I32, value: 1 }], {
            kind: "ret",
            value: "%0",
          }),
        ]
      )
    );

    const after = runLifecyclePass(before, noDecisions);
    const insts = (after.functions[0] as KirFunction).blocks[0]?.instructions;
    expect(insts).toEqual([{ kind: "const_int", dest: "%0", type: I32, value: 1 }]);
    const terminator = (after.functions[0] as KirFunction).blocks[0]?.terminator;
    expect(terminator).toEqual({ kind: "ret", value: "%0" });
  });

  test("mark_param in a non-exit block is stripped but emits no destroy there", () => {
    // The pass collects markers from any block, but only *appends*
    // destroys to blocks whose terminator is `ret`/`ret_void`. A block
    // that ends in `jump` carries no destroy — the param destroy fires
    // at the destination's exit terminator instead.
    const before = moduleWith(
      fn(
        "j",
        [structParam("p", "Bag")],
        [
          block("entry", [{ kind: "mark_param", param: "%p" }], { kind: "jump", target: "exit" }),
          block("exit", [], { kind: "ret_void" }),
        ]
      )
    );

    const after = runLifecyclePass(before, noDecisions);
    const blocks = (after.functions[0] as KirFunction).blocks;
    expect(blocks[0]?.instructions).toEqual([]);
    expect(blocks[1]?.instructions).toEqual([{ kind: "destroy", value: "%p", structName: "Bag" }]);
  });

  test("does not mutate the input module", () => {
    const marker: KirInst = { kind: "mark_param", param: "%p" };
    const beforeBlock = block("entry", [marker], { kind: "ret_void" });
    const before = moduleWith(fn("f", [structParam("p", "Bag")], [beforeBlock]));

    runLifecyclePass(before, noDecisions);

    expect(beforeBlock.instructions).toEqual([marker]);
    expect(beforeBlock.terminator).toEqual({ kind: "ret_void" });
  });
});
