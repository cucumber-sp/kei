/**
 * Integration test for the constructed-and-threaded `Collector` pattern.
 *
 * PR 1's `collector.test.ts` covers isolation at the Collector level.
 * This file extends the coverage one layer up: two `Checker` instances,
 * each given its own `Diagnostics` sink, do not leak diagnostics into
 * each other's snapshot. The whole point of moving the sink onto
 * `CheckerOptions` (`docs/design/diagnostics-module.md` §5 PR 3) is so
 * this property holds.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics, type Diagnostics } from "../../src/diagnostics";
import { messageOf } from "../../src/diagnostics/format";
import { parseSource } from "../helpers/pipeline";

function checkWithSink(content: string, filename: string, diag: Diagnostics) {
  const { source, program } = parseSource(content, filename);
  return new Checker(program, source, "", { diag }).check();
}

describe("Checker — externalised Collector isolation", () => {
  test("two Checkers, two Collectors — diagnostics stay on the right sink", () => {
    const diagA = createDiagnostics({});
    const diagB = createDiagnostics({});

    // Programs are syntactically well-formed but each references a
    // distinct undeclared identifier, so each Checker emits at least
    // one diagnostic and the messages are individually identifiable.
    checkWithSink("fn main() { let x = nope_a; }", "a.kei", diagA);
    checkWithSink("fn main() { let y = nope_b; }", "b.kei", diagB);

    const messagesA = diagA.diagnostics().map(messageOf);
    const messagesB = diagB.diagnostics().map(messageOf);

    expect(messagesA.some((m) => m.includes("nope_a"))).toBe(true);
    expect(messagesA.some((m) => m.includes("nope_b"))).toBe(false);
    expect(messagesB.some((m) => m.includes("nope_b"))).toBe(true);
    expect(messagesB.some((m) => m.includes("nope_a"))).toBe(false);
  });

  test("a Checker uses the sink it was given — diagnostics appear there", () => {
    const diag = createDiagnostics({});
    expect(diag.diagnostics()).toEqual([]);

    checkWithSink("fn main() { let z = missing_name; }", "c.kei", diag);

    const snap = diag.diagnostics();
    expect(snap.some((d) => d.kind === "undeclaredName" && d.name === "missing_name")).toBe(true);
  });
});
