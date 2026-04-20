import { describe, expect, test } from "bun:test";
import { lowerAndPrint, lowerFunction } from "./helpers";

describe("KIR: nullable type (T?)", () => {
  test("T? param lowers to ptr<T>", () => {
    const fn = lowerFunction(
      `
      struct Node { val: i32; }
      fn foo(n: Node?) -> i32 { return 0; }
    `,
      "foo"
    );
    expect(fn.params[0]!.type.kind).toBe("ptr");
    const pointee = (fn.params[0]!.type as { kind: "ptr"; pointee: { kind: string; name: string } })
      .pointee;
    expect(pointee.kind).toBe("struct");
    expect(pointee.name).toBe("Node");
  });

  test("T? return type lowers to ptr<T>", () => {
    const fn = lowerFunction(
      `
      struct Node { val: i32; }
      fn foo() -> Node? { return null; }
    `,
      "foo"
    );
    expect(fn.returnType.kind).toBe("ptr");
    const pointee = (fn.returnType as { kind: "ptr"; pointee: { kind: string; name: string } })
      .pointee;
    expect(pointee.kind).toBe("struct");
    expect(pointee.name).toBe("Node");
  });

  test("null is assignable to T? variable", () => {
    // Should compile without type errors
    const kir = lowerAndPrint(`
      struct Node { val: i32; }
      fn foo() {
        let p: Node? = null;
      }
    `);
    expect(kir).toContain("const_null");
  });

  test("primitive T? lowers to ptr<T>", () => {
    const fn = lowerFunction(
      `
      fn foo(x: i32?) -> i32 { return 0; }
    `,
      "foo"
    );
    expect(fn.params[0]!.type).toEqual({
      kind: "ptr",
      pointee: { kind: "int", bits: 32, signed: true },
    });
  });

  test("T? field in unsafe struct lowers to ptr", () => {
    const kir = lowerAndPrint(`
      struct Inner { x: i32; }
      unsafe struct Outer {
        child: Inner?;
        fn __destroy(self: Outer) {}
        fn __oncopy(self: Outer) -> Outer { return Outer { child: null }; }
      }
      fn foo() {}
    `);
    // The struct type decl for Outer should have a ptr field
    expect(kir).toContain("ptr");
  });

  test("ptr<T>? lowers to ptr<ptr<T>>", () => {
    const fn = lowerFunction(
      `
      fn foo(p: ptr<i32>?) -> i32 { return 0; }
    `,
      "foo"
    );
    expect(fn.params[0]!.type).toEqual({
      kind: "ptr",
      pointee: { kind: "ptr", pointee: { kind: "int", bits: 32, signed: true } },
    });
  });
});

describe("parser: nullable type syntax", () => {
  test("T? parses as NullableType", () => {
    // If it parses without error, we're good
    expect(() =>
      lowerAndPrint(`
        struct Foo { x: i32; }
        fn bar(f: Foo?) {}
      `)
    ).not.toThrow();
  });

  test("nested T?? is double nullable", () => {
    expect(() =>
      lowerAndPrint(`
        fn bar(x: i32??) {}
      `)
    ).not.toThrow();
  });
});
