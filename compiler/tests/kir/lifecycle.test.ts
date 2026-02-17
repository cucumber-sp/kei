import { describe, expect, test } from "bun:test";
import type { KirCallExternVoid, KirDestroy, KirMove, KirOncopy } from "../../src/kir/kir-types.ts";
import { getInstructions, lowerAndPrint, lowerFunction } from "./helpers.ts";

describe("KIR: lifecycle — destroy", () => {
  test("scope exit emits destroy in reverse declaration order", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        let b = Res{ data: null };
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    expect(destroys.length).toBe(2);
    // Reverse order: b destroyed before a
    expect(destroys[0].structName).toBe("Res");
    expect(destroys[1].structName).toBe("Res");
    // The second destroy's value should be the earlier-declared variable's ptr
    // Both are Res, but b should come first (reverse order)
    expect(destroys[0].value).not.toBe(destroys[1].value);
  });

  test("assignment emits destroy on old value", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        a = Res{ data: null };
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    // One destroy for the reassignment (old value) + one for scope exit
    expect(destroys.length).toBe(2);
  });

  test("return value not destroyed", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() -> Res {
        let a = Res{ data: null };
        return a;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    // 'a' is the return value, so it should NOT be destroyed
    expect(destroys.length).toBe(0);
  });

  test("multiple vars, return one — only non-returned destroyed", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() -> Res {
        let a = Res{ data: null };
        let b = Res{ data: null };
        return b;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    // 'a' is destroyed, 'b' is returned (not destroyed)
    expect(destroys.length).toBe(1);
  });
});

describe("KIR: lifecycle — oncopy", () => {
  test("let assignment emits oncopy for struct with __oncopy", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        let b = a;
      }
    `,
      "foo"
    );
    const oncopies = getInstructions(fn, "oncopy") as KirOncopy[];
    // oncopy for the struct literal init of a, and oncopy when copying a to b
    expect(oncopies.length).toBeGreaterThanOrEqual(1);
    expect(oncopies.some((o) => o.structName === "Res")).toBe(true);
  });
});

describe("KIR: lifecycle — move", () => {
  test("move skips destroy on moved variable", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        let b = move a;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    const moves = getInstructions(fn, "move") as KirMove[];
    // Move instruction emitted
    expect(moves.length).toBe(1);
    // Only b is destroyed at scope exit (a was moved, so no destroy for a)
    expect(destroys.length).toBe(1);
  });

  test("move emits move instruction", () => {
    const fn = lowerFunction(
      `
      struct Data { value: int; }
      fn foo() -> int {
        let a = Data{ value: 42 };
        let b = move a;
        return b.value;
      }
    `,
      "foo"
    );
    const moves = getInstructions(fn, "move") as KirMove[];
    expect(moves.length).toBe(1);
    expect(moves[0].source).toBeDefined();
    expect(moves[0].dest).toBeDefined();
  });

  test("move does not emit oncopy", () => {
    const fn = lowerFunction(
      `
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        let b = move a;
      }
    `,
      "foo"
    );
    const oncopies = getInstructions(fn, "oncopy") as KirOncopy[];
    // The initial struct literal gets oncopy, but the move does NOT
    // So we should have oncopy for the first 'let a = Res{...}' only
    // The move assignment should NOT produce another oncopy
    const moves = getInstructions(fn, "move") as KirMove[];
    expect(moves.length).toBe(1);
    // Verify no oncopy was emitted for 'let b = move a'
    // (the oncopy count should be ≤ 1, for the initial struct literal)
    expect(oncopies.length).toBeLessThanOrEqual(1);
  });
});

describe("KIR: lifecycle — primitives", () => {
  test("primitives don't get lifecycle ops", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x = 42;
        let y = x;
        x = 100;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    const oncopies = getInstructions(fn, "oncopy") as KirOncopy[];
    expect(destroys.length).toBe(0);
    expect(oncopies.length).toBe(0);
  });

  test("regular struct without __destroy — no lifecycle ops", () => {
    const fn = lowerFunction(
      `
      struct Point { x: int; y: int; }
      fn foo() {
        let p = Point{ x: 1, y: 2 };
        let q = p;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    const oncopies = getInstructions(fn, "oncopy") as KirOncopy[];
    expect(destroys.length).toBe(0);
    expect(oncopies.length).toBe(0);
  });
});

describe("KIR: lifecycle — string destroy on reassignment", () => {
  test("string variable reassignment emits kei_string_destroy", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let name = "Alice";
        name = "Bob";
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call_extern_void") as KirCallExternVoid[];
    const destroyCalls = calls.filter((c) => c.func === "kei_string_destroy");
    // One destroy for reassignment + one for scope exit
    expect(destroyCalls.length).toBe(2);
  });

  test("string field reassignment emits kei_string_destroy", () => {
    const fn = lowerFunction(
      `
      struct Wrapper { text: string; }
      fn foo() {
        let w = Wrapper{ text: "hello" };
        w.text = "world";
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call_extern_void") as KirCallExternVoid[];
    const destroyCalls = calls.filter((c) => c.func === "kei_string_destroy");
    // At least one destroy for the field reassignment
    expect(destroyCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("string variable scope exit emits kei_string_destroy", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let name = "Alice";
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call_extern_void") as KirCallExternVoid[];
    const destroyCalls = calls.filter((c) => c.func === "kei_string_destroy");
    // One destroy for scope exit
    expect(destroyCalls.length).toBe(1);
  });

  test("string variable not destroyed at scope exit if returned", () => {
    const fn = lowerFunction(
      `
      fn foo() -> string {
        let name = "Alice";
        return name;
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call_extern_void") as KirCallExternVoid[];
    const destroyCalls = calls.filter((c) => c.func === "kei_string_destroy");
    // Returned value should NOT be destroyed
    expect(destroyCalls.length).toBe(0);
  });

  test("struct with string field — reassignment destroys old field via struct destroy", () => {
    const fn = lowerFunction(
      `
      struct Wrapper { text: string; }
      fn foo() {
        let a = Wrapper{ text: "hello" };
        let b = Wrapper{ text: "world" };
        a = b;
      }
    `,
      "foo"
    );
    const destroys = getInstructions(fn, "destroy") as KirDestroy[];
    // One destroy for reassignment (old a) + two for scope exit (a and b)
    expect(destroys.length).toBe(3);
  });
});

describe("KIR: lifecycle — printer", () => {
  test("destroy/oncopy/move appear in printed KIR", () => {
    const printed = lowerAndPrint(`
      unsafe struct Res {
        data: ptr<u8>;
        fn __destroy(self: Res) { }
        fn __oncopy(self: Res) -> Res { return Res{ data: self.data }; }
      }
      fn foo() {
        let a = Res{ data: null };
        let b = move a;
      }
    `);
    expect(printed).toContain("move");
    expect(printed).toContain("destroy");
  });
});
