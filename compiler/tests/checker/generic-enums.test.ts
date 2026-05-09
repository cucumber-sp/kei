import { describe, expect, test } from "bun:test";
import { parse } from "../parser/helpers";
import { check, checkOk } from "./helpers";

describe("generic enums — parser + checker", () => {
  test("`enum Foo<T> { ... }` parses with genericParams", () => {
    const program = parse(`
      enum Optional<T> {
        Some(value: T),
        None
      }
    `);
    const decl = program.declarations[0];
    if (decl?.kind !== "EnumDecl") throw new Error("expected EnumDecl");
    expect(decl.genericParams).toEqual(["T"]);
    expect(decl.variants.length).toBe(2);
  });

  test("`enum Pair<A, B> { ... }` parses with two generic params", () => {
    const program = parse(`
      enum Either<A, B> {
        Left(value: A),
        Right(value: B)
      }
    `);
    const decl = program.declarations[0];
    if (decl?.kind !== "EnumDecl") throw new Error("expected EnumDecl");
    expect(decl.genericParams).toEqual(["A", "B"]);
  });

  test("payload field referencing a type parameter typechecks", () => {
    checkOk(`
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("`Optional<i32>.Some(7)` instantiates and typechecks", () => {
    checkOk(`
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let x = Optional<i32>.Some(7);
        return 0;
      }
    `);
  });

  test("`Optional<i32>.Some(true)` reports a type mismatch on the payload", () => {
    const diags = check(`
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let x = Optional<i32>.Some(true);
        return 0;
      }
    `);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const messages = errors.map((d) => d.message).join("\n");
    expect(messages).toContain("expected 'i32', got 'bool'");
  });

  test("two distinct instantiations produce distinct enum types", () => {
    // `Optional<i32>` and `Optional<bool>` should be incompatible.
    const diags = check(`
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn use_int(x: Optional<i32>) {}
      fn main() -> i32 {
        use_int(Optional<bool>.Some(true));
        return 0;
      }
    `);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("`Optional<i32>.None` is allowed (variant with no payload)", () => {
    checkOk(`
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let x = Optional<i32>.None;
        return 0;
      }
    `);
  });
});
